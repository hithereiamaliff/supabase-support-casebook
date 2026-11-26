# Multi-tenant RLS: checking the thread's recommended pattern

**Thread:** https://github.com/supabase/supabase/discussions/50617 (19 Sep 2026, no accepted answer on 26 Nov 2026)
**Run it:** `npm run case -- 50617` | [transcript](transcript.md) | [case.js](case.js)

## The question

The poster is building a multi-tenant warehouse app and asked:

- how to derive a user's `organization_id` safely
- how to give a platform owner access without weakening row level security
- how to stop anyone moving a row to another organisation on INSERT or UPDATE

## What the replies said

The thread is already well answered, by a collaborator and others. The pattern they converge on:

- look up organisations in a membership table, through a `security definer` helper with an empty `search_path`, kept out of `public`
- write separate policies for each command, and on UPDATE check both `using` and `with check`
- add a trigger that freezes `organization_id`
- read the platform-owner flag from a table, not the JWT

This case checks that the pattern really holds, one identity at a time.

## What the reproduction shows

**Who sees which products:**

| Who | Sees |
|---|---|
| anon | nothing |
| Alice (in Acme) | Acme's product |
| Bob (in Acme and Globex) | both products |
| Carol (platform owner) | both products |
| service_role | both products |

**Then:**

1. **Writes to other organisations are blocked.** Alice can't add a product to Globex. Row level security rejects it.
2. **`with check` alone isn't enough.** Because Bob belongs to both organisations, `with check` would let him move a product between them. The freeze trigger stops it.
3. **Ordinary edits still work.**
4. **The platform owner's updates fail silently.** Carol has no update policy, so her update matches no rows. She gets no error, only 0 rows.
5. **The helper prevents a classic error.** A policy on `memberships` that queries `memberships` fails with `infinite recursion detected in policy`. Products keep working, because the helper reads memberships as its owner.

## The reply I'd send

> Hi! The answers above give a solid pattern, and I ran it end to end to check it: https://github.com/hithereiamaliff/supabase-support-casebook/tree/main/cases/50617-multi-tenant-rls . Two results are worth knowing before you build on it:
>
> 1. **`with check` alone doesn't stop a row moving between organisations.** It only checks that the new organisation is one of the user's. Someone who belongs to two organisations can still move a row from one to the other. If `organization_id` must never change, keep the freeze trigger.
> 2. **A platform owner with only a select policy doesn't get an error on writes.** Their updates match no rows and return nothing. If they need to change data, give that its own path, such as a server-side function using the service role, so it's deliberate and logged.
>
> And if you add row level security to `memberships` itself, keep its policies from querying `memberships` directly. That recursion error is what the security definer helper avoids.

## Classification

- **A best-practice question,** answered in the thread. The reproduction turns the advice into checks that pass or fail, and finds two edge cases the answers don't spell out.
- **Docs idea:** a worked multi-tenant example with a "who sees what" table like the one above would answer this whole family of questions.
