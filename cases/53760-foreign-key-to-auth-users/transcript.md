# Transcript: A foreign key to auth.users: create the table as postgres

Case: https://github.com/supabase/supabase/discussions/53760

The case's setup ran first. See `setup` in case.js.

## 1. One reply: as postgres, grant the migrator access to auth.users

As `postgres`:

```sql
grant usage on schema auth to custom_migrator;
grant references on table auth.users to custom_migrator;
```

Succeeded, with no rows returned.

Notices:

- `WARNING: no privileges were granted for "auth"`
- `WARNING: no privileges were granted for "users"`

## 2. Both grants were warnings, so the migrator still can't create the foreign key

As `custom_migrator`:

```sql
create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete restrict
);
```

**Error:** `permission denied for schema auth` (SQLSTATE 42501)

## 3. The other replies: create the table as postgres, then grant the app role its access

As `postgres`:

```sql
create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete restrict,
  display_name text
);
grant select, insert, update, delete on public.profiles to app_owner;
```

Succeeded, with no rows returned.

## 4. Handing the table to the NOLOGIN owner fails for the reason in case #52069

As `postgres`:

```sql
alter table public.profiles owner to app_owner;
```

**Error:** `must be able to SET ROLE "app_owner"` (SQLSTATE 42501)

## 5. If app_owner must own it: postgres can give itself SET on the role it created, then hand it over

As `postgres`:

```sql
grant app_owner to postgres with set true, inherit false;
alter table public.profiles owner to app_owner;
select tableowner from pg_tables where schemaname = 'public' and tablename = 'profiles';
```

| tableowner |
|---|
| app_owner |

## 6. The app role can use the table

As `app_owner`:

```sql
insert into public.profiles (user_id, display_name) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Alice') returning user_id, display_name;
```

| user_id | display_name |
|---|---|
| aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa | Alice |

## 7. The cost of ON DELETE RESTRICT: deleting the user now fails

As `supabase_auth_admin`:

```sql
delete from auth.users where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
```

**Error:** `update or delete on table "users" violates RESTRICT setting of foreign key constraint "profiles_user_id_fkey" on table "profiles"` (SQLSTATE 23001)

Every step behaved as the case expects.
