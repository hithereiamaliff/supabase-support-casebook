/**
 * A throwaway Postgres shaped like a Supabase project's database, running inside Node.js.
 *
 * It uses PGlite (real Postgres compiled to WebAssembly), so there's nothing to install
 * beyond `npm install`, nothing to sign up for, and every run starts from a clean database.
 *
 * "Supabase-shaped" means the parts support questions usually turn on (see bootstrap.sql):
 * - the superuser is supabase_admin, and postgres is an ordinary role, as on hosted projects
 * - the anon, authenticated and service_role roles the Data API switches to
 * - auth.uid(), auth.role(), auth.email() and auth.jwt(), copied from Supabase's auth repo
 * - minimal auth.users and storage tables, with Supabase's column types and owners
 *
 * What it is not: it has no Data API (PostgREST), no auth server and no storage server.
 * Questions about those need a real project.
 */

import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const BOOTSTRAP_SQL = readFileSync(new URL("./bootstrap.sql", import.meta.url), "utf8");

/** The roles the Data API switches to. Requests reach them through authenticator. */
const API_ROLES = new Set(["anon", "authenticated", "service_role"]);

/** Fixed users for the cases, so outputs are the same on every run. */
export const USERS = {
  alice: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  bob: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  carol: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
};

/** Starts a fresh Supabase-shaped database. */
export async function startSupabaseDb() {
  const pg = new PGlite();

  // PGlite boots as a superuser called "postgres". On Supabase, that name belongs to an
  // ordinary role and the superuser is supabase_admin. Give the boot superuser Supabase's
  // name, so that grants and errors read exactly as they would on a hosted project.
  // (A role can't be renamed while it's the session user, hence the temporary superuser.)
  await pg.exec(`
    create role pglite_boot_tmp superuser;
    set session authorization pglite_boot_tmp;
    alter role postgres rename to supabase_admin;
    set session authorization supabase_admin;
    drop role pglite_boot_tmp;
  `);
  await pg.exec(BOOTSTRAP_SQL);
  return new SupabaseDb(pg);
}

/** Turns an identity into a label: "postgres", "authenticated (alice)" and so on. */
export function describeIdentity({ as = "supabase_admin", user } = {}) {
  const name = Object.entries(USERS).find(([, id]) => id === user)?.[0];
  return user ? `${as} (${name ?? user})` : as;
}

export class SupabaseDb {
  constructor(pg) {
    this.pg = pg;
  }

  /**
   * Runs SQL as one identity and reports what happened, without throwing.
   *
   * as     a role name: "postgres" (the SQL editor), "anon", "authenticated", "service_role",
   *        "supabase_admin", or any role a case creates
   * user   for "authenticated": the signed-in user's id. It's put in the JWT claims,
   *        so auth.uid() and auth.jwt() return it, as they would for an API request.
   * claims extra JWT claims, for example { app_metadata: { role: "platform_owner" } }
   *
   * Returns { ok, rows, error: { message, code }, notices: ["WARNING: ..."] }.
   * Everything runs in one transaction, which is committed if every statement succeeds.
   */
  async run(sql, { as = "supabase_admin", user, claims = {} } = {}) {
    const notices = [];
    const onNotice = (notice) => notices.push(`${notice.severity}: ${notice.message}`);
    const jwt = { role: as, ...(user ? { sub: user } : {}), ...claims };

    // Become the identity the way a real connection would, so that permission checks
    // which look at the session user (such as SET ROLE) behave as they do on Supabase:
    // - API roles: connect as authenticator, then SET ROLE, which is what PostgREST does
    // - any other role (postgres, a migration role...): log in as that role directly
    const becomeIdentity = API_ROLES.has(as)
      ? `set local session authorization authenticator; set local role ${quoteIdent(as)};`
      : `set local session authorization ${quoteIdent(as)};`;
    const prelude =
      as === "supabase_admin"
        ? "begin;"
        : `begin; ${becomeIdentity}
           select set_config('request.jwt.claims', ${quoteLiteral(JSON.stringify(jwt))}, true);`;

    try {
      const results = await this.pg.exec(`${prelude}\n${sql}\n;commit;`, { onNotice });
      const withRows = results.filter((result) => result.fields?.length);
      // The last result with columns is the one to show. The prelude's set_config
      // also returns a row, so skip it when the case's own SQL returned nothing.
      const own = withRows.filter((result) => result.fields[0]?.name !== "set_config");
      return { ok: true, rows: own.at(-1)?.rows ?? [], error: null, notices };
    } catch (error) {
      await this.pg.exec("rollback;").catch(() => {});
      return { ok: false, rows: [], error: { message: error.message, code: error.code }, notices };
    }
  }

  /**
   * Runs the same query as several identities: the "who sees what" view that answers
   * most row level security questions. Returns [{ identity, ok, rows, error }].
   */
  async whoSees(sql, identities) {
    const results = [];
    for (const identity of identities) {
      const result = await this.run(sql, identity);
      results.push({ identity: describeIdentity(identity), ...result });
    }
    return results;
  }

  async close() {
    await this.pg.close();
  }
}

function quoteIdent(name) {
  return `"${String(name).replace(/"/g, '""')}"`;
}

function quoteLiteral(text) {
  return `'${String(text).replace(/'/g, "''")}'`;
}
