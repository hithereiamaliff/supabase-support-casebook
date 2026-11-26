# A foreign key to auth.users: create the table as postgres

**Thread:** https://github.com/supabase/supabase/discussions/53760 (20 Nov 2026, no accepted answer on 26 Nov 2026)
**Run it:** `npm run case -- 53760` | [transcript](transcript.md) | [case.js](case.js)

## The question

The poster needs `public.profiles(user_id)` to reference `auth.users(id)` with `ON DELETE RESTRICT`. The table should be created by a separate migration role, with a NOLOGIN role as its owner. Their `postgres` role can use the `auth` schema and reference `auth.users`, but it doesn't have the grant option for either.

## What the replies said

- **Two replies:** create the table as `postgres`, then grant the app role what it needs.
- **The third:** as `postgres`, grant the migration role `USAGE` on `auth` and `REFERENCES` on `auth.users`.

## What the reproduction shows

1. **The third reply's grants do nothing.** Run as `postgres`, they only warn, with `no privileges were granted for "auth"` and for `"users"`. `postgres` holds those privileges without the grant option, so it can't pass them on.
2. **So the migration role still can't create the foreign key.** It gets `permission denied for schema auth`.
3. **The other replies' answer works.** Creating the table as `postgres` succeeds, and the app role can then use it.
4. **Handing the table to the NOLOGIN owner fails at first.** The error is `must be able to SET ROLE "app_owner"`, the same Postgres 16+ rule as [case #52069](../52069-createrole-admin-membership/README.md).
5. **It works once two things are true:**
   - `postgres` gives itself SET on the role it created: `grant app_owner to postgres with set true, inherit false`.
   - The owner role can create in the table's schema. Postgres checks this when ownership changes.
6. **The cost of `ON DELETE RESTRICT`:** deleting the user then fails while they have a profile.

## The reply I'd send

> Hi! Create the table as `postgres`; that's the route that works. `postgres` can reference `auth.users`, but it holds those privileges without the grant option, so it can't pass them on. The grants to your migration role only produce "no privileges were granted" warnings, which the SQL editor doesn't show. The migration role's `CREATE TABLE` then fails with "permission denied for schema auth".
>
> So create `public.profiles` and its foreign key as `postgres`, then grant your app role the table privileges it needs. Keep any later migration that changes that foreign key in the part you run as `postgres`.
>
> If the NOLOGIN role must own the table, you can hand it over afterwards, as `postgres`:
>
> ```sql
> grant app_owner to postgres with set true, inherit false;  -- postgres created app_owner, so it may do this
> alter table public.profiles owner to app_owner;            -- app_owner also needs CREATE on schema public
> ```
>
> One thing to plan for: with `ON DELETE RESTRICT`, deleting a user fails while they have a profile, whether the delete comes from the dashboard or the auth admin API. If that's intended, delete the profile first in your account-deletion flow. If not, Supabase's own guide uses `ON DELETE CASCADE`: https://supabase.com/docs/guides/auth/managing-user-data
>
> I reproduced each step here: https://github.com/hithereiamaliff/supabase-support-casebook/tree/main/cases/53760-foreign-key-to-auth-users

## Classification

- **Question about permissions:** the behaviour is expected.
- **One reply in the thread would lead the poster astray.** Its grants look like they succeed, because the SQL editor hides the warnings.
- **Worth a Knowledge Base entry:** "Referencing auth.users from tables created by other roles".

## Notes on the reproduction

- **The privileges are modelled.** `postgres`'s privileges on `auth` are modelled on what the post describes: usage and references, without the grant option.
- **The error code differs by version.** Postgres 19, which PGlite runs, reports the delete error with SQLSTATE 23001 and the words "violates RESTRICT setting of foreign key constraint". The thread's replies report 23503 on hosted Postgres 17.
