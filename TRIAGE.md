# How I'd run the APAC weekend queue

The shift covers Friday to Monday, 00:00 to 10:00 UTC (8am to 6pm in Penang). Most of the company is offline for much of it, so the aim is simple: no customer waits on a weekend that didn't need to, and Monday starts with clear notes, not surprises.

## Order of work

1. **Before the first reply:**
   - Read the last shift's handover notes.
   - Check the status page and any open incident, so I don't troubleshoot an outage one ticket at a time.
2. **Tickets by plan and severity:**
   - Enterprise first, which has 24/7 cover and a shared Slack channel.
   - Then Team-plan tickets within their SLAs.
   - Then Pro email support.
3. **Community channels in the gaps:** GitHub Issues and Discussions, and Discord. Unanswered questions with a clear error message come first, because they're the quickest to unblock.

## Answering

- **One complete first reply, not three.** If something's missing, ask for all of it at once:
  - the project ref
  - the exact error, including any warnings
  - the SQL that was run, and as which role
  - when it happened

  Threads stall on rounds of "can you send the exact error?".
- **Reproduce before replying to database questions.** Most row level security, grant and migration questions reproduce in a minute with the [repro kit](README.md#the-repro-kit). Send the reproduction with the answer, so the customer can see it working and the next engineer can reuse it.
- **Say what the SQL editor didn't.** GRANT and REVOKE often "succeed" with only a warning ([#52113](cases/52113-revoke-has-no-effect/README.md), [#53760](cases/53760-foreign-key-to-auth-users/README.md)). When something "worked but nothing changed", check for warnings first.

## Escalate, don't sit on it

- **Possible data loss, an outage, or exposed data** (for example a sensitive table with row level security off): page on-call straight away, and tell the customer it's escalated.
- **Billing and account changes:** the billing team, with the details gathered.
- **Product bugs:** a GitHub issue with a minimal reproduction, linked from the ticket.
- **Docs bugs:** fix them directly where docs accept contributions; otherwise raise them with the docs owners.

## Handover for Monday

For each open ticket:
- what's been tried
- what it's waiting on, and from whom
- the next step

Also a short list of anything that came up more than once over the weekend, because repeats are where documentation and tooling pay off.

## Patterns these five cases point to

1. **Warnings hidden by the SQL editor.**
   - Two of the five threads are GRANT or REVOKE statements that only warned, and Supabase already has a Knowledge Base article on the same effect with pg_net.
   - **Suggestion:** show warnings under the result in the SQL editor, as `psql` does.
2. **Postgres 16+ role-membership rules surprise people moving to Postgres 17.**
   - The creator of a role becomes its admin automatically, and can't hand over ownership without SET ([#52069](cases/52069-createrole-admin-membership/README.md), [#53760](cases/53760-foreign-key-to-auth-users/README.md)).
   - **Suggestion:** a Knowledge Base entry would save the next ticket.
3. **SQL examples in the docs can break unnoticed.**
   - The Storage guide's policies failed with `text = uuid` for everyone who copied them ([#53952](cases/53952-storage-policy-text-uuid/README.md)).
   - **Suggestion:** run every SQL example in the docs against a Supabase-shaped database in CI, the way this kit runs cases. That would fail the build before anyone copied a broken example.
