# Postgres 16+ makes the role's creator its admin, and postgres can't revoke it

**Thread:** https://github.com/supabase/supabase/discussions/52069 (21 Oct 2026, no accepted answer on 26 Nov 2026)
**Run it:** `npm run case -- 52069` | [transcript](transcript.md) | [case.js](case.js)

## The question

A migration on Supabase Postgres 17 creates NOLOGIN owner roles. The poster's guard requires those roles to have "zero membership edges", but Postgres gives `postgres`, the role that created them, a membership of its own, so the guard fails. They asked for a supported way around it, and a least-privilege pattern.

## What the replies said

The three replies disagree:

- **One:** the membership is expected, granted by the bootstrap superuser with ADMIN on and INHERIT and SET off, and `postgres` can't revoke it.
- **Another:** it carries INHERIT and SET too, and `REVOKE trucking_importer_owner FROM postgres` plus `REVOKE ADMIN OPTION ...` remove it, leaving "0 rows".
- **A third:** it corrects the second, from the Postgres docs.

## What the reproduction shows

1. **Postgres adds the membership itself.** Creating the role as `postgres` adds a row with member `postgres` and grantor `supabase_admin`, with ADMIN `true`, INHERIT `false` and SET `false`.
2. **Neither REVOKE does anything.** Both only warn: `role "postgres" has not been granted membership in role "trucking_importer_owner" by role "postgres"`. The row is unchanged, so the "0 rows" answer doesn't hold.
3. **It's harmless.** `postgres` can't use the role's privileges, and `SET ROLE trucking_importer_owner` fails. It can only manage who else belongs to the role.
4. **A guard can still work.** One that accepts exactly that row passes, and it still catches a real membership.

## The reply I'd send

> Hi! The extra membership is expected on Postgres 16 and later, so it applies to the Postgres 17 your project runs. When a role without superuser rights creates another role, Postgres automatically makes the creator an admin of the new role. It records the bootstrap superuser, `supabase_admin` on Supabase, as the grantor. Because `postgres` isn't the grantor, `REVOKE ... FROM postgres` only prints a warning and leaves the membership in place. The SQL editor doesn't show warnings, so it looks as if it worked.
>
> For least privilege, this membership is harmless. It's created with INHERIT and SET off, so `postgres` can't use the owner role's privileges or switch to it. It can only manage who else is a member.
>
> So I'd keep your guard, but let it accept that one row: member `postgres`, grantor `supabase_admin`, ADMIN true, INHERIT false, SET false. Anything else still fails it, such as a role that can SET or INHERIT the owner role:
>
> ```sql
> select r.rolname as role, m.rolname as member, g.rolname as grantor,
>        am.admin_option, am.inherit_option, am.set_option
> from pg_auth_members am
> join pg_roles r on r.oid = am.roleid
> join pg_roles m on m.oid = am.member
> join pg_roles g on g.oid = am.grantor
> where r.rolname = 'trucking_importer_owner'
>   and not (m.rolname = 'postgres' and g.rolname = 'supabase_admin'
>            and am.admin_option and not am.inherit_option and not am.set_option);
> -- No rows: the guard passes.
> ```
>
> I reproduced this step by step: https://github.com/hithereiamaliff/supabase-support-casebook/tree/main/cases/52069-createrole-admin-membership . If your requirement really is zero rows, only a superuser can remove it, so that's one for the support ticket you have open.

## Classification

- **Expected Postgres behaviour** (16 and later), not a Supabase bug.
- **Worth a Knowledge Base entry:** "Why is postgres a member of roles it creates?" The question will keep coming as more projects move to Postgres 17.
- The `createrole_self_grant` setting can also give the creator INHERIT or SET, but it can't turn off the ADMIN grant: https://www.postgresql.org/docs/17/runtime-config-client.html#GUC-CREATEROLE-SELF-GRANT
