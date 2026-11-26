# Transcript: Multi-tenant RLS: checking the thread's recommended pattern

Case: https://github.com/supabase/supabase/discussions/50617

The case's setup ran first. See `setup` in case.js.

## 1. Who sees which products

Run as each of: `anon`, `authenticated (alice)`, `authenticated (bob)`, `authenticated (carol)`, `service_role`

```sql
select p.name, o.name as organization
from public.products p
join public.organizations o on o.id = p.organization_id
order by p.name
```

| Who | What they get |
|---|---|
| anon | no rows |
| authenticated (alice) | Acme widget, Acme |
| authenticated (bob) | Acme widget, Acme; Globex gadget, Globex |
| authenticated (carol) | Acme widget, Acme; Globex gadget, Globex |
| service_role | Acme widget, Acme; Globex gadget, Globex |

## 2. Alice can't add a product to Globex

As `authenticated (alice)`:

```sql
insert into public.products (organization_id, name) values ('b0000000-0000-4000-8000-000000000002', 'Sneaky');
```

**Error:** `new row violates row-level security policy for table "products"` (SQLSTATE 42501)

## 3. Bob belongs to both, so WITH CHECK alone would let him move a row. The trigger stops it

As `authenticated (bob)`:

```sql
update public.products set organization_id = 'b0000000-0000-4000-8000-000000000002' where name = 'Acme widget';
```

**Error:** `organization_id can't be changed` (SQLSTATE P0001)

## 4. Ordinary edits still work

As `authenticated (alice)`:

```sql
update public.products set name = 'Acme widget v2' where name = 'Acme widget' returning name;
```

| name |
|---|
| Acme widget v2 |

## 5. The platform owner can read everything, but an update quietly changes nothing

As `authenticated (carol)`:

```sql
update public.products set name = name || ' (edited)' returning name;
```

Succeeded, with no rows returned.

## 6. Why the helper is security definer: a policy that queries its own table recurses

As `postgres`:

```sql
alter table public.memberships enable row level security;
grant select on public.memberships to authenticated;
create policy memberships_naive on public.memberships for select to authenticated
  using (organization_id in (select organization_id from public.memberships where user_id = (select auth.uid())));
```

Succeeded, with no rows returned.

## 7. ...and reading memberships now fails

As `authenticated (alice)`:

```sql
select organization_id from public.memberships;
```

**Error:** `infinite recursion detected in policy for relation "memberships"` (SQLSTATE 42P17)

## 8. Products still work, because the helper reads memberships as its owner

As `authenticated (alice)`:

```sql
select p.name, o.name as organization
from public.products p
join public.organizations o on o.id = p.organization_id
order by p.name
```

| name | organization |
|---|---|
| Acme widget v2 | Acme |

Every step behaved as the case expects.
