# Transcript: Postgres 16+ makes the role's creator its admin, and postgres can't revoke it

Case: https://github.com/supabase/supabase/discussions/52069

## 1. postgres creates a NOLOGIN owner role, as the migration does

As `postgres`:

```sql
create role trucking_importer_owner nologin;
```

Succeeded, with no rows returned.

## 2. Postgres has added a membership by itself, granted by the superuser

As `postgres`:

```sql
select r.rolname as role, m.rolname as member, g.rolname as grantor,
       am.admin_option, am.inherit_option, am.set_option
from pg_auth_members am
join pg_roles r on r.oid = am.roleid
join pg_roles m on m.oid = am.member
join pg_roles g on g.oid = am.grantor
where r.rolname = 'trucking_importer_owner'
order by member
```

| role | member | grantor | admin_option | inherit_option | set_option |
|---|---|---|---|---|---|
| trucking_importer_owner | postgres | supabase_admin | true | false | false |

## 3. One reply says postgres can revoke it

As `postgres`:

```sql
revoke trucking_importer_owner from postgres;
```

Succeeded, with no rows returned.

Notices:

- `WARNING: role "postgres" has not been granted membership in role "trucking_importer_owner" by role "postgres"`

## 4. ...and the admin option along with it

As `postgres`:

```sql
revoke admin option for trucking_importer_owner from postgres;
```

Succeeded, with no rows returned.

Notices:

- `WARNING: role "postgres" has not been granted membership in role "trucking_importer_owner" by role "postgres"`

## 5. Neither did anything: the membership is unchanged

As `postgres`:

```sql
select r.rolname as role, m.rolname as member, g.rolname as grantor,
       am.admin_option, am.inherit_option, am.set_option
from pg_auth_members am
join pg_roles r on r.oid = am.roleid
join pg_roles m on m.oid = am.member
join pg_roles g on g.oid = am.grantor
where r.rolname = 'trucking_importer_owner'
order by member
```

| role | member | grantor | admin_option | inherit_option | set_option |
|---|---|---|---|---|---|
| trucking_importer_owner | postgres | supabase_admin | true | false | false |

## 6. What it allows: managing the role, but not acting as it

As `postgres`:

```sql
select pg_has_role('postgres', 'trucking_importer_owner', 'USAGE') as uses_its_privileges,
                   pg_has_role('postgres', 'trucking_importer_owner', 'SET') as can_set_role_to_it,
                   pg_has_role('postgres', 'trucking_importer_owner', 'MEMBER WITH ADMIN OPTION') as can_manage_its_members
```

| uses_its_privileges | can_set_role_to_it | can_manage_its_members |
|---|---|---|
| false | false | true |

## 7. Trying to act as the role confirms it

As `postgres`:

```sql
set role trucking_importer_owner;
```

**Error:** `permission denied to set role "trucking_importer_owner"` (SQLSTATE 42501)

## 8. A guard that allows exactly this automatic row, and nothing else

As `postgres`:

```sql
select r.rolname as role, m.rolname as member, g.rolname as grantor,
       am.admin_option, am.inherit_option, am.set_option
from pg_auth_members am
join pg_roles r on r.oid = am.roleid
join pg_roles m on m.oid = am.member
join pg_roles g on g.oid = am.grantor
where r.rolname = 'trucking_importer_owner'
  and not (m.rolname = 'postgres' and g.rolname = 'supabase_admin'
           and am.admin_option and not am.inherit_option and not am.set_option)
```

Succeeded, with no rows returned.

## 9. The guard still catches a real membership

As `postgres`:

```sql
create role importer_api_role nologin;
grant trucking_importer_owner to importer_api_role with inherit true;
select r.rolname as role, m.rolname as member, g.rolname as grantor,
       am.admin_option, am.inherit_option, am.set_option
from pg_auth_members am
join pg_roles r on r.oid = am.roleid
join pg_roles m on m.oid = am.member
join pg_roles g on g.oid = am.grantor
where r.rolname = 'trucking_importer_owner'
  and not (m.rolname = 'postgres' and g.rolname = 'supabase_admin'
           and am.admin_option and not am.inherit_option and not am.set_option)
```

| role | member | grantor | admin_option | inherit_option | set_option |
|---|---|---|---|---|---|
| trucking_importer_owner | importer_api_role | postgres | false | true | true |

Every step behaved as the case expects.
