# REVOKE as postgres does nothing on a table supabase_admin owns

**Thread:** https://github.com/supabase/supabase/discussions/52113 (21 Oct 2026, no accepted answer on 26 Nov 2026)
**Run it:** `npm run case -- 52113` | [transcript](transcript.md) | [case.js](case.js)

## The question

PostGIS is installed in `public`. The poster ran `REVOKE ALL ON TABLE public.spatial_ref_sys FROM anon, authenticated` as `postgres`, yet `has_table_privilege('anon', 'public.spatial_ref_sys', 'DELETE')` still returns true.

## What the replies said

- **A collaborator:** reinstall PostGIS in the `extensions` schema.
- **Another reply:** the REVOKE issues a warning rather than an error, and the SQL editor hides warnings.

Both are right. The reproduction shows why.

## What the reproduction shows

1. **Where the grants come from.** The table is created by `supabase_admin`, as installing PostGIS into `public` does. Supabase's default privileges then grant it in full to `anon` and `authenticated`, with `supabase_admin` as the grantor.
2. **The REVOKE only warns.** Run as `postgres`, it "succeeds" but prints `no privileges could be revoked for "spatial_ref_sys"`, and one more warning per column.
3. **`anon` can still delete.**
4. **Only the grantor can take the grants back.** As `supabase_admin`, the same REVOKE works.

## The reply I'd send

> Hi! The REVOKE didn't fail; it just had nothing it was allowed to revoke. Those grants were made by `supabase_admin`. PostGIS was installed into `public`, and Supabase's default privileges grant anything `supabase_admin` creates there to the API roles. In Postgres, only the role that made a grant can revoke it, so as `postgres` the statement prints "no privileges could be revoked" warnings instead of an error. The SQL editor doesn't display warnings, so it looks as if it worked. Supabase's Knowledge Base describes the same effect with pg_net: https://supabase.com/kb/troubleshooting/revoking-access-to-pg_net-objects-has-no-effect
>
> The fix is the one GaryAustin1 gave: reinstall PostGIS into the `extensions` schema. That schema isn't exposed through the Data API, and `spatial_ref_sys` is only reference data. Plan it as a migration, with a backup first: dropping the extension also drops what depends on it, including your `geography` columns. The PostGIS guide covers the move: https://supabase.com/docs/guides/database/extensions/postgis
>
> If you can't move it yet, write to support, because only `supabase_admin` can change those grants.
>
> Step-by-step reproduction: https://github.com/hithereiamaliff/supabase-support-casebook/tree/main/cases/52113-revoke-has-no-effect

## Classification

- **Expected behaviour,** and already answered by a collaborator. The reproduction adds the "why".
- **Product feedback:** the SQL editor's silence on warnings causes the same confusion here as in the pg_net Knowledge Base article. Showing warnings under the result, as `psql` does, would remove a whole class of "it said success but nothing changed" tickets. Case #53760 hits the same thing with GRANT.

## Notes on the reproduction

- **A stand-in table.** The `spatial_ref_sys` table here is a plain table with the same name, columns and owner as PostGIS's, so the case runs without PostGIS. The grants behave the same way.
