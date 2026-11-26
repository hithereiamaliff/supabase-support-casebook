# Transcript: REVOKE as postgres does nothing on a table supabase_admin owns

Case: https://github.com/supabase/supabase/discussions/52113

The case's setup ran first. See `setup` in case.js.

## 1. Supabase's default privileges gave anon and authenticated full access

As `postgres`:

```sql
select a.grantee::regrole::text as grantee, a.grantor::regrole::text as grantor,
       string_agg(a.privilege_type, ', ' order by a.privilege_type) as privileges
from pg_class c, aclexplode(c.relacl) a
where c.oid = 'public.spatial_ref_sys'::regclass
  and a.grantee::regrole::text in ('anon', 'authenticated')
group by 1, 2
order by 1
```

| grantee | grantor | privileges |
|---|---|---|
| anon | supabase_admin | DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE |
| authenticated | supabase_admin | DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE |

## 2. REVOKE as postgres, as in the SQL editor: it "succeeds", with warnings

As `postgres`:

```sql
revoke all on table public.spatial_ref_sys from anon, authenticated;
```

Succeeded, with no rows returned.

Notices:

- `WARNING: no privileges could be revoked for "spatial_ref_sys"`
- `WARNING: no privileges could be revoked for column "tableoid" of relation "spatial_ref_sys"`
- ...and 10 more like these, one for each column

## 3. anon can still delete

As `postgres`:

```sql
select has_table_privilege('anon', 'public.spatial_ref_sys', 'DELETE') as anon_can_delete;
```

| anon_can_delete |
|---|
| true |

## 4. Only the grantor can take its grants back

As `supabase_admin`:

```sql
revoke all on table public.spatial_ref_sys from anon, authenticated;
select has_table_privilege('anon', 'public.spatial_ref_sys', 'DELETE') as anon_can_delete;
```

| anon_can_delete |
|---|
| false |

Every step behaved as the case expects.
