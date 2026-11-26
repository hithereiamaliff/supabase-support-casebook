// Every case is also a test: each step must behave the way its case.js expects.
// Plus a few checks that the Supabase-shaped database itself is right.
// Run with: npm test

import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { loadCases, runCase } from "../src/run-cases.js";
import { startSupabaseDb, USERS } from "../src/supabase-db.js";

describe("the Supabase-shaped database", () => {
  let db;
  before(async () => {
    db = await startSupabaseDb();
  });
  after(async () => {
    await db.close();
  });

  test("supabase_admin is the superuser and postgres is not", async () => {
    const result = await db.run("select rolname, rolsuper from pg_roles where rolname in ('supabase_admin', 'postgres') order by rolname");
    assert.deepEqual(result.rows, [
      { rolname: "postgres", rolsuper: false },
      { rolname: "supabase_admin", rolsuper: true },
    ]);
  });

  test("API requests connect as authenticator, then switch role, as PostgREST does", async () => {
    const result = await db.run("select session_user, current_user", { as: "anon" });
    assert.deepEqual(result.rows, [{ session_user: "authenticator", current_user: "anon" }]);
  });

  test("auth.uid() and auth.jwt() return the signed-in user", async () => {
    const result = await db.run("select auth.uid() as uid, auth.jwt() ->> 'sub' as sub, auth.role() as role", {
      as: "authenticated",
      user: USERS.alice,
    });
    assert.deepEqual(result.rows, [{ uid: USERS.alice, sub: USERS.alice, role: "authenticated" }]);
  });

  test("errors are reported, not thrown, and the database stays usable", async () => {
    const failed = await db.run("select 1 / 0", { as: "postgres" });
    assert.equal(failed.ok, false);
    assert.match(failed.error.message, /division by zero/);
    const next = await db.run("select 1 as still_fine");
    assert.deepEqual(next.rows, [{ still_fine: 1 }]);
  });

  test("warnings are captured", async () => {
    await db.run("create table public.warning_test (id int)");
    const result = await db.run("revoke all on public.warning_test from anon", { as: "postgres" });
    assert.ok(result.notices.some((notice) => /no privileges could be revoked/.test(notice)));
  });
});

describe("the cases", async () => {
  const cases = await loadCases();

  test("there are cases to run", () => {
    assert.ok(cases.length >= 5);
  });

  for (const testCase of cases) {
    test(testCase.folder, async () => {
      const { failures } = await runCase(testCase);
      assert.deepEqual(failures, []);
    });
  }
});
