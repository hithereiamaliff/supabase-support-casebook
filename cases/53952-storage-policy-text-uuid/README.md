# Storage policies: owner_id is text, auth.uid() is uuid

**Issue:** https://github.com/supabase/supabase/issues/53952 (24 Nov 2026). Fixed in the docs the next day by https://github.com/supabase/supabase/pull/53953
**Run it:** `npm run case -- 53952` | [transcript](transcript.md) | [case.js](case.js)

## The issue

The Storage guide's copy and move examples (https://supabase.com/docs/guides/storage/management/copy-move-objects) compared `storage.objects.owner_id`, a `text` column, with `auth.uid()`, which returns `uuid`. Every one of those policies failed when you created it.

## What the reproduction shows

1. **The policy from before the fix fails** with `operator does not exist: text = uuid`.
2. **The fixed policy works.** It compares with `auth.jwt()->>'sub'`, and each user sees only their own objects.
3. **The fixed folder-based upload policy works.** Alice can upload into her own folder but not into Bob's.
4. **Casting also works:** `owner_id = (select auth.uid()::text)`.

## The reply I'd have sent, while it was open

> Thanks for the report! Confirmed: `storage.objects.owner_id` is `text`, while `auth.uid()` returns `uuid`, so these examples fail with "operator does not exist: text = uuid". Comparing with `auth.jwt()->>'sub'`, which is text, fixes it. It also follows the comment Supabase's auth migrations put on `auth.uid()`: "Deprecated. Use auth.jwt() -> 'sub' instead." Casting works too: `owner_id = (select auth.uid()::text)`.
>
> Reproduction, with the old and fixed policies side by side: https://github.com/hithereiamaliff/supabase-support-casebook/tree/main/cases/53952-storage-policy-text-uuid

## Classification

- **A docs bug,** already fixed. It stays here as a regression test: if the fixed examples ever break again, `npm test` fails.

## The tooling idea it points to

This kind of bug is easy to catch automatically. Every SQL example in the docs could be run against a Supabase-shaped database in CI, the way this kit runs cases. The text = uuid error would have failed the build before anyone copied the example. See [TRIAGE.md](../../TRIAGE.md).

## Notes on the reproduction

- **The table's shape is copied from Supabase.** The `storage.objects` columns come from Supabase's storage migrations, including `owner_id text` from migration 0018.
- **The policies are created as the superuser,** so permissions play no part. On a hosted project you'd run them in the SQL editor.
