// Issue #53952: the Storage guide's copy/move policy examples compared owner_id (text)
// with auth.uid() (uuid). Fixed in the docs on 25 Nov 2026 (PR #53953). This case keeps
// both versions as a regression test, and checks that the fixed policies behave.
// The policies are created as the superuser here, so that permissions play no part:
// on a hosted project you would run them in the SQL editor.
import { USERS } from "../../src/supabase-db.js";

const objects = "select name from storage.objects order by name";

export default {
  title: "Storage policies: owner_id is text, auth.uid() is uuid",
  link: "https://github.com/supabase/supabase/issues/53952",
  setup: [
    {
      as: "supabase_admin",
      sql: `
insert into storage.buckets (id, name) values ('files', 'files');
insert into storage.objects (bucket_id, name, owner_id) values
  ('files', '${USERS.alice}/alice-report.pdf', '${USERS.alice}'),
  ('files', '${USERS.bob}/bob-report.pdf', '${USERS.bob}');`,
    },
  ],
  steps: [
    {
      title: "The guide's policy before the fix",
      as: "supabase_admin",
      sql: `
create policy "User can select their own objects (in any buckets)"
on storage.objects
for select
to authenticated
using (
    owner_id = (select auth.uid())
);`,
      expect: { error: /operator does not exist: text = uuid/ },
    },
    {
      title: "The guide's policy after the fix",
      as: "supabase_admin",
      sql: `
create policy "User can select their own objects (in any buckets)"
on storage.objects
for select
to authenticated
using (
    owner_id = (select auth.jwt()->>'sub')
);`,
      expect: { ok: true },
    },
    {
      title: "Each user sees only their own objects",
      whoSees: [{ as: "anon" }, { as: "authenticated", user: USERS.alice }, { as: "authenticated", user: USERS.bob }],
      sql: objects,
      expect: { anon: 0, "authenticated (alice)": 1, "authenticated (bob)": 1 },
    },
    {
      title: "The guide's folder-based upload policy, fixed the same way",
      as: "supabase_admin",
      sql: `
create policy "User can upload to their own folders (in any buckets)"
on storage.objects
for insert
to authenticated
with check (
    (storage.foldername(name))[1] = (select auth.jwt()->>'sub')
);`,
      expect: { ok: true },
    },
    {
      title: "Alice can upload into her own folder",
      as: "authenticated",
      user: USERS.alice,
      sql: `insert into storage.objects (bucket_id, name, owner_id) values ('files', '${USERS.alice}/notes.txt', '${USERS.alice}') returning name;`,
      expect: { rows: [{ name: `${USERS.alice}/notes.txt` }] },
    },
    {
      title: "...but not into Bob's",
      as: "authenticated",
      user: USERS.alice,
      sql: `insert into storage.objects (bucket_id, name, owner_id) values ('files', '${USERS.bob}/notes.txt', '${USERS.alice}');`,
      expect: { error: /new row violates row-level security policy for table "objects"/ },
    },
    {
      title: "Keeping auth.uid() also works, with an explicit cast",
      as: "supabase_admin",
      sql: `
create policy "Select own objects, auth.uid() version"
on storage.objects for select to authenticated
using (owner_id = (select auth.uid()::text));`,
      expect: { ok: true },
    },
  ],
};
