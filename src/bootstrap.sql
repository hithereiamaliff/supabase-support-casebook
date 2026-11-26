-- A Supabase-shaped database for reproductions: the roles, schemas, grants and auth
-- functions that most support questions turn on. It runs as supabase_admin, the
-- superuser, after src/supabase-db.js has given PGlite's boot superuser that name.
--
-- Copied (and trimmed to what the cases need) from Supabase's own sources, checked 26 Nov 2026:
--   supabase/postgres  migrations/db/init-scripts/00000000000000-initial-schema.sql
--   supabase/postgres  migrations/db/init-scripts/00000000000001-auth-schema.sql
--   supabase/postgres  migrations/db/init-scripts/00000000000002-storage-schema.sql
--   supabase/auth      migrations/20220224000811_update_auth_functions.up.sql
--   supabase/auth      migrations/20220531120530_add_auth_jwt_function.up.sql
--   supabase/storage   migrations/tenant/0002-storage-schema.sql
--   supabase/storage   migrations/tenant/0018-add_owner_id_column_deprecate_owner.sql

-- Roles ---------------------------------------------------------------------------

-- postgres is the role the dashboard's SQL editor uses on a hosted project. It can
-- create roles and bypass row level security, but it isn't a superuser, which is why
-- so many permission questions arise.
create role postgres login createrole createdb replication bypassrls;
grant create on database postgres to postgres;  -- it can create schemas
grant create on schema public to postgres;      -- and tables in public

-- The roles the Data API switches to for each request.
create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;
create role authenticator login noinherit;
grant anon, authenticated, service_role to authenticator;

create schema if not exists extensions;
grant usage on schema public to postgres, anon, authenticated, service_role;
grant usage on schema extensions to postgres, anon, authenticated, service_role;

-- Anything supabase_admin creates in public is granted to these roles automatically.
-- This is why, for example, PostGIS's spatial_ref_sys table arrives with full access
-- for anon and authenticated when PostGIS is installed into public.
alter default privileges for user supabase_admin in schema public
  grant all on tables to postgres, anon, authenticated, service_role;
alter default privileges for user supabase_admin in schema public
  grant all on functions to postgres, anon, authenticated, service_role;
alter default privileges for user supabase_admin in schema public
  grant all on sequences to postgres, anon, authenticated, service_role;

-- auth ----------------------------------------------------------------------------

create schema auth authorization supabase_admin;

create table auth.users (
  instance_id uuid null,
  id uuid not null primary key,
  aud varchar(255) null,
  "role" varchar(255) null,
  email varchar(255) null unique,
  raw_app_meta_data jsonb null,
  raw_user_meta_data jsonb null,
  created_at timestamptz null default now(),
  updated_at timestamptz null default now()
);

-- The request's JWT claims arrive as the request.jwt.claims setting, which is what
-- PostgREST sets for every API request. src/supabase-db.js sets it the same way.
create or replace function auth.uid() returns uuid language sql stable as $$
  select
  coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;

create or replace function auth.role() returns text language sql stable as $$
  select
  coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )::text
$$;

create or replace function auth.email() returns text language sql stable as $$
  select
  coalesce(
    nullif(current_setting('request.jwt.claim.email', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email')
  )::text
$$;

create or replace function auth.jwt() returns jsonb language sql stable as $$
  select
    coalesce(
        nullif(current_setting('request.jwt.claim', true), ''),
        nullif(current_setting('request.jwt.claims', true), '')
    )::jsonb
$$;

comment on function auth.uid() is 'Deprecated. Use auth.jwt() -> ''sub'' instead.';

grant usage on schema auth to anon, authenticated, service_role;
-- Not in the first init script, but true on hosted projects: postgres can use the auth
-- schema, which is how the policies and functions it creates call auth.uid().
grant usage on schema auth to postgres;

create role supabase_auth_admin noinherit createrole login noreplication;
grant all privileges on schema auth to supabase_auth_admin;
grant all privileges on all tables in schema auth to supabase_auth_admin;
alter table auth.users owner to supabase_auth_admin;

-- storage -------------------------------------------------------------------------

create schema storage authorization supabase_admin;

create role supabase_storage_admin noinherit createrole login noreplication;
grant usage on schema storage to postgres, anon, authenticated, service_role;
alter default privileges in schema storage grant all on tables to postgres, anon, authenticated, service_role;
alter default privileges in schema storage grant all on functions to postgres, anon, authenticated, service_role;
alter default privileges in schema storage grant all on sequences to postgres, anon, authenticated, service_role;
grant all on schema storage to supabase_storage_admin with grant option;

create table storage.buckets (
  id text not null primary key,
  name text not null,
  owner uuid,              -- deprecated, use owner_id
  owner_id text default null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table storage.objects (
  id uuid not null default gen_random_uuid() primary key,
  bucket_id text references storage.buckets(id),
  name text,
  owner uuid,              -- deprecated, use owner_id
  owner_id text default null,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  last_accessed_at timestamptz default now(),
  metadata jsonb
);

create or replace function storage.foldername(name text) returns text[] language plpgsql as $function$
declare
  _parts text[];
begin
  select string_to_array(name, '/') into _parts;
  return _parts[1:array_length(_parts, 1) - 1];
end
$function$;

alter table storage.buckets owner to supabase_storage_admin;
alter table storage.objects owner to supabase_storage_admin;
alter function storage.foldername(text) owner to supabase_storage_admin;
alter table storage.objects enable row level security;
