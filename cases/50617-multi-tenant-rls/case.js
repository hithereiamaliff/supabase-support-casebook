// Discussion #50617: multi-tenant row level security. Derive the user's organisations
// from a membership table, give a platform owner read access, and stop anyone moving a
// row to another organisation. This case checks that the pattern from the thread's
// answers really holds, one identity at a time.
import { USERS } from "../../src/supabase-db.js";

const ACME = "a0000000-0000-4000-8000-000000000001";
const GLOBEX = "b0000000-0000-4000-8000-000000000002";

const products = `
select p.name, o.name as organization
from public.products p
join public.organizations o on o.id = p.organization_id
order by p.name`;

export default {
  title: "Multi-tenant RLS: checking the thread's recommended pattern",
  link: "https://github.com/supabase/supabase/discussions/50617",
  setup: [
    {
      as: "postgres",
      sql: `
create schema private;
grant usage on schema private to authenticated;

create table public.organizations (id uuid primary key, name text not null);
create table public.memberships (
  user_id uuid not null,
  organization_id uuid not null references public.organizations (id),
  primary key (user_id, organization_id)
);
create table public.products (
  id serial primary key,
  organization_id uuid not null references public.organizations (id),
  name text not null
);
create table private.platform_owners (user_id uuid primary key);

-- Helpers, as the answers suggest: security definer, an empty search_path, and
-- schema-qualified names, kept out of public and callable only by authenticated.
create function private.user_org_ids() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select organization_id from public.memberships where user_id = (select auth.uid())
$$;
create function private.is_platform_owner() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from private.platform_owners where user_id = (select auth.uid()))
$$;
revoke all on function private.user_org_ids() from public;
revoke all on function private.is_platform_owner() from public;
grant execute on function private.user_org_ids() to authenticated;
grant execute on function private.is_platform_owner() to authenticated;

alter table public.organizations enable row level security;
alter table public.products enable row level security;
-- The API roles get table privileges, so that row level security is what decides.
grant select on public.organizations to anon, authenticated, service_role;
grant select on public.products to anon;
grant select, insert, update, delete on public.products to authenticated, service_role;
grant usage, select on sequence public.products_id_seq to authenticated, service_role;

create policy organizations_select on public.organizations for select to authenticated
  using (id in (select private.user_org_ids()) or (select private.is_platform_owner()));

create policy products_select on public.products for select to authenticated
  using (organization_id in (select private.user_org_ids()) or (select private.is_platform_owner()));
create policy products_insert on public.products for insert to authenticated
  with check (organization_id in (select private.user_org_ids()));
create policy products_update on public.products for update to authenticated
  using (organization_id in (select private.user_org_ids()))
  with check (organization_id in (select private.user_org_ids()));
create policy products_delete on public.products for delete to authenticated
  using (organization_id in (select private.user_org_ids()));

-- The "freeze" trigger from the thread: a row's organisation can never change.
create function private.freeze_org_id() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.organization_id is distinct from old.organization_id then
    raise exception 'organization_id can''t be changed';
  end if;
  return new;
end
$$;
create trigger products_freeze_org before update on public.products
  for each row execute function private.freeze_org_id();`,
    },
    {
      // Alice is in Acme. Bob is in both Acme and Globex. Carol is the platform owner.
      as: "postgres",
      sql: `
insert into public.organizations values ('${ACME}', 'Acme'), ('${GLOBEX}', 'Globex');
insert into public.memberships values
  ('${USERS.alice}', '${ACME}'), ('${USERS.bob}', '${ACME}'), ('${USERS.bob}', '${GLOBEX}');
insert into private.platform_owners values ('${USERS.carol}');
insert into public.products (organization_id, name) values ('${ACME}', 'Acme widget'), ('${GLOBEX}', 'Globex gadget');`,
    },
  ],
  steps: [
    {
      title: "Who sees which products",
      whoSees: [
        { as: "anon" },
        { as: "authenticated", user: USERS.alice },
        { as: "authenticated", user: USERS.bob },
        { as: "authenticated", user: USERS.carol },
        { as: "service_role" },
      ],
      sql: products,
      expect: {
        anon: 0,
        "authenticated (alice)": 1,
        "authenticated (bob)": 2,
        "authenticated (carol)": 2,
        service_role: 2,
      },
    },
    {
      title: "Alice can't add a product to Globex",
      as: "authenticated",
      user: USERS.alice,
      sql: `insert into public.products (organization_id, name) values ('${GLOBEX}', 'Sneaky');`,
      expect: { error: /new row violates row-level security policy for table "products"/ },
    },
    {
      title: "Bob belongs to both, so WITH CHECK alone would let him move a row. The trigger stops it",
      as: "authenticated",
      user: USERS.bob,
      sql: `update public.products set organization_id = '${GLOBEX}' where name = 'Acme widget';`,
      expect: { error: /organization_id can't be changed/ },
    },
    {
      title: "Ordinary edits still work",
      as: "authenticated",
      user: USERS.alice,
      sql: "update public.products set name = 'Acme widget v2' where name = 'Acme widget' returning name;",
      expect: { rows: [{ name: "Acme widget v2" }] },
    },
    {
      title: "The platform owner can read everything, but an update quietly changes nothing",
      as: "authenticated",
      user: USERS.carol,
      sql: "update public.products set name = name || ' (edited)' returning name;",
      expect: { rows: [] },
    },
    {
      title: "Why the helper is security definer: a policy that queries its own table recurses",
      as: "postgres",
      sql: `
alter table public.memberships enable row level security;
grant select on public.memberships to authenticated;
create policy memberships_naive on public.memberships for select to authenticated
  using (organization_id in (select organization_id from public.memberships where user_id = (select auth.uid())));`,
      expect: { ok: true },
    },
    {
      title: "...and reading memberships now fails",
      as: "authenticated",
      user: USERS.alice,
      sql: "select organization_id from public.memberships;",
      expect: { error: /infinite recursion detected in policy for relation "memberships"/ },
    },
    {
      title: "Products still work, because the helper reads memberships as its owner",
      as: "authenticated",
      user: USERS.alice,
      sql: products,
      expect: { rows: [{ name: "Acme widget v2", organization: "Acme" }] },
    },
  ],
};
