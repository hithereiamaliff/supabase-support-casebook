// Discussion #53760: a migration role and a NOLOGIN owner need public.profiles to
// reference auth.users. One reply says to grant the migrator access to auth.users
// as postgres. The others say to create the table as postgres. Which works?
import { USERS } from "../../src/supabase-db.js";

export default {
  title: "A foreign key to auth.users: create the table as postgres",
  link: "https://github.com/supabase/supabase/discussions/53760",
  setup: [
    {
      // The privileges the post describes: postgres can use the auth schema and reference
      // auth.users, but without the grant option, so it can't pass them on.
      as: "supabase_admin",
      sql: `
grant usage on schema auth to postgres;
grant select, references on auth.users to postgres;
insert into auth.users (id, email, role, aud) values ('${USERS.alice}', 'alice@example.com', 'authenticated', 'authenticated');`,
    },
    {
      // The roles from the post: a migration role that logs in, and a NOLOGIN owner.
      as: "postgres",
      sql: "create role custom_migrator login; create role app_owner nologin;",
    },
    {
      // Assume both roles may create in public. Postgres needs this for the owner role too:
      // a table's new owner must be able to create objects in the table's schema.
      as: "supabase_admin",
      sql: "grant create on schema public to custom_migrator, app_owner;",
    },
  ],
  steps: [
    {
      title: "One reply: as postgres, grant the migrator access to auth.users",
      as: "postgres",
      sql: `
grant usage on schema auth to custom_migrator;
grant references on table auth.users to custom_migrator;`,
      expect: { ok: true, notice: /no privileges were granted for "users"/ },
    },
    {
      title: "Both grants were warnings, so the migrator still can't create the foreign key",
      as: "custom_migrator",
      sql: `
create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete restrict
);`,
      expect: { error: /permission denied for schema auth/ },
    },
    {
      title: "The other replies: create the table as postgres, then grant the app role its access",
      as: "postgres",
      sql: `
create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete restrict,
  display_name text
);
grant select, insert, update, delete on public.profiles to app_owner;`,
      expect: { ok: true },
    },
    {
      title: "Handing the table to the NOLOGIN owner fails for the reason in case #52069",
      as: "postgres",
      sql: "alter table public.profiles owner to app_owner;",
      expect: { error: /must be able to SET ROLE "app_owner"/ },
    },
    {
      title: "If app_owner must own it: postgres can give itself SET on the role it created, then hand it over",
      as: "postgres",
      sql: `
grant app_owner to postgres with set true, inherit false;
alter table public.profiles owner to app_owner;
select tableowner from pg_tables where schemaname = 'public' and tablename = 'profiles';`,
      expect: { rows: [{ tableowner: "app_owner" }] },
    },
    {
      title: "The app role can use the table",
      as: "app_owner",
      sql: `insert into public.profiles (user_id, display_name) values ('${USERS.alice}', 'Alice') returning user_id, display_name;`,
      expect: { rows: [{ user_id: USERS.alice, display_name: "Alice" }] },
    },
    {
      title: "The cost of ON DELETE RESTRICT: deleting the user now fails",
      as: "supabase_auth_admin",
      sql: `delete from auth.users where id = '${USERS.alice}';`,
      // Postgres 19 (PGlite) reports SQLSTATE 23001 and says "violates RESTRICT setting of
      // foreign key constraint". On hosted Postgres 17, the thread's replies report 23503.
      expect: { error: /violates (RESTRICT setting of )?foreign key constraint "profiles_user_id_fkey"/ },
    },
  ],
};
