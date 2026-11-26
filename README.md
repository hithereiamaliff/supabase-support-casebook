# Supabase support casebook

Real questions from Supabase's GitHub, reproduced in a Supabase-shaped Postgres that runs inside Node.js, and answered the way support would.

Built on 25 and 26 November 2026, as a work sample for Supabase's Support Engineer (APAC, Weekends) role.

## Why reproduce

In three of these five threads, confident answers contradict each other. Running the problem for real settles which answer is right. It also shows why the wrong ones look right: Postgres often answers a permission mistake with a warning, not an error, and the dashboard's SQL editor doesn't show warnings.

## The cases

| Thread | The question | What the reproduction settled | Kind |
|---|---|---|---|
| [#52069](cases/52069-createrole-admin-membership/README.md) | Postgres 17 gives `postgres` a membership in roles it creates. How do I remove it? | It can't be removed by `postgres`, and it doesn't need to be: it grants no privileges. A guard can accept exactly that row | Expected Postgres 16+ behaviour |
| [#53760](cases/53760-foreign-key-to-auth-users/README.md) | A migration role needs a foreign key to `auth.users` | Granting the migration role access only warns. Create the table as `postgres`, then hand it over, which needs two extra steps | Permissions question |
| [#52113](cases/52113-revoke-has-no-effect/README.md) | `REVOKE` on PostGIS's `spatial_ref_sys` does nothing | Only the grantor, `supabase_admin`, can revoke. Move PostGIS to `extensions` | Expected behaviour; product feedback |
| [#50617](cases/50617-multi-tenant-rls/README.md) | A safe multi-tenant row level security pattern | The thread's pattern holds, plus two edge cases it doesn't spell out | Best practice |
| [#53952](cases/53952-storage-policy-text-uuid/README.md) | The Storage guide's policies fail with `text = uuid` | Old version fails, fixed version works. Kept as a regression test | Docs bug, fixed 25 Nov |

Each case folder has:
- **README.md:** the question, what the replies said, what the reproduction shows, the reply I'd send, and how I'd classify it
- **case.js:** the reproduction
- **transcript.md:** what actually happened when it ran

## The repro kit

The posting mentions finding internal tooling that would make support faster. This is a small example: `src/supabase-db.js` starts a throwaway database shaped like a Supabase project's, in about a second, with nothing to install but npm.

```js
import { startSupabaseDb, USERS } from "./src/supabase-db.js";

const db = await startSupabaseDb();
await db.run("create table public.notes (owner uuid, body text)", { as: "postgres" });

// The view that answers most row level security tickets:
const view = await db.whoSees("select * from public.notes", [
  { as: "anon" },
  { as: "authenticated", user: USERS.alice },
  { as: "service_role" },
]);
```

**What "Supabase-shaped" means** (copied from Supabase's own repos; the sources are listed in [src/bootstrap.sql](src/bootstrap.sql)):

- **Roles:**
  - `supabase_admin` is the superuser, and `postgres` is an ordinary role that can create roles, as on hosted projects
  - the API roles `anon`, `authenticated` and `service_role`, which requests reach through `authenticator`, as with PostgREST
- **Functions:** `auth.uid()`, `auth.role()`, `auth.email()` and `auth.jwt()`, reading the request's JWT claims
- **Tables:** `auth.users`, `storage.buckets` and `storage.objects`, with Supabase's column types and owners
- **Privileges:** Supabase's default privileges, which is why tables `supabase_admin` creates in `public` reach the API roles

**How identities work:**
- `postgres`, or any other role, logs in as itself, so permission checks behave as they would for a real connection.
- API roles connect as `authenticator` and switch role.
- A signed-in user's id goes into the JWT claims.

**Limits:**
- **No servers.** There's no Data API (PostgREST), auth server or storage server, so questions about those need a real project.
- **A newer Postgres.** PGlite runs Postgres 19, while hosted projects run 15 or 17. The behaviour in these cases is the same, but some messages are worded differently, as noted in case #53760.

## Run it

```bash
npm install
npm test                 # every case is also a test: 11 tests, all offline
npm run cases            # run every case and print what happened
npm run case -- 52069    # run one case
npm run transcripts      # rewrite each case's transcript.md
```

**To add a case:**
1. Copy a case folder.
2. Write the `setup`.
3. Add `steps`, each with an identity (`as`, `user`), the `sql`, and what you `expect`: rows, an error, a warning, or a row count per identity.

## How I'd run the weekend queue

[TRIAGE.md](TRIAGE.md) covers how I'd sort and answer an APAC weekend queue, what to escalate, and three patterns these cases point to.

## How I used AI

I used Claude Code, an AI coding assistant, throughout:
- to read Supabase's source
- to vet the threads
- to build the kit
- to draft the replies

I checked its work the way I'd check an answer before sending it to a customer:

- **Every claim is a passing test.** Each case runs against real Postgres. If a step doesn't behave the way the README says, `npm test` fails.
- **Copied, not guessed.** Supabase's definitions (roles, auth functions, storage tables) come from its repositories and are cited, not written from memory.
- **The first version of the kit was wrong, and the cases caught it.**
  - It switched to `postgres` with `SET ROLE` from a superuser session. Postgres checks role switches against the session user, so `SET ROLE` succeeded where it should fail.
  - A step expecting "permission denied" failed, and the kit now logs in as each role instead.
- **Not every thread was worth answering.** Two of the original candidates were already fixed or had a fix pending. Several recent threads read as templated. I kept the ones whose underlying question is real and reproducible, and wrote the replies to stand on the technical question alone.

## License

MIT, by Aliff. `src/bootstrap.sql` adapts definitions from Supabase's open-source repositories; see [LICENSE](LICENSE).
