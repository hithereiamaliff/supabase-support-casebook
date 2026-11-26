# Transcript: Storage policies: owner_id is text, auth.uid() is uuid

Case: https://github.com/supabase/supabase/issues/53952

The case's setup ran first. See `setup` in case.js.

## 1. The guide's policy before the fix

As `supabase_admin`:

```sql
create policy "User can select their own objects (in any buckets)"
on storage.objects
for select
to authenticated
using (
    owner_id = (select auth.uid())
);
```

**Error:** `operator does not exist: text = uuid` (SQLSTATE 42883)

## 2. The guide's policy after the fix

As `supabase_admin`:

```sql
create policy "User can select their own objects (in any buckets)"
on storage.objects
for select
to authenticated
using (
    owner_id = (select auth.jwt()->>'sub')
);
```

Succeeded, with no rows returned.

## 3. Each user sees only their own objects

Run as each of: `anon`, `authenticated (alice)`, `authenticated (bob)`

```sql
select name from storage.objects order by name
```

| Who | What they get |
|---|---|
| anon | no rows |
| authenticated (alice) | aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/alice-report.pdf |
| authenticated (bob) | bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/bob-report.pdf |

## 4. The guide's folder-based upload policy, fixed the same way

As `supabase_admin`:

```sql
create policy "User can upload to their own folders (in any buckets)"
on storage.objects
for insert
to authenticated
with check (
    (storage.foldername(name))[1] = (select auth.jwt()->>'sub')
);
```

Succeeded, with no rows returned.

## 5. Alice can upload into her own folder

As `authenticated (alice)`:

```sql
insert into storage.objects (bucket_id, name, owner_id) values ('files', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/notes.txt', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') returning name;
```

| name |
|---|
| aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/notes.txt |

## 6. ...but not into Bob's

As `authenticated (alice)`:

```sql
insert into storage.objects (bucket_id, name, owner_id) values ('files', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/notes.txt', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
```

**Error:** `new row violates row-level security policy for table "objects"` (SQLSTATE 42501)

## 7. Keeping auth.uid() also works, with an explicit cast

As `supabase_admin`:

```sql
create policy "Select own objects, auth.uid() version"
on storage.objects for select to authenticated
using (owner_id = (select auth.uid()::text));
```

Succeeded, with no rows returned.

Every step behaved as the case expects.
