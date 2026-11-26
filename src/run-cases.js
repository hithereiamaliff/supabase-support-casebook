/**
 * Runs the cases in cases/, each in a fresh Supabase-shaped database, and checks every
 * step against what the case expects. A case is a reproduction and a test at once.
 *
 *   node src/run-cases.js            run every case and print what happened
 *   node src/run-cases.js 52069      run the cases whose folder name contains "52069"
 *   node src/run-cases.js --write    also save each case's transcript.md
 *
 * Exits with 1 if any step didn't behave as its case expects.
 */

import { readdirSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describeIdentity, startSupabaseDb } from "./supabase-db.js";

const CASES_DIR = new URL("../cases/", import.meta.url);

/** Loads every case module, optionally filtered by part of its folder name. */
export async function loadCases(filter = "") {
  const folders = readdirSync(CASES_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.includes(filter))
    .map((entry) => entry.name)
    .sort();
  const cases = [];
  for (const folder of folders) {
    const module = await import(pathToFileURL(fileURLToPath(new URL(`${folder}/case.js`, CASES_DIR))).href);
    cases.push({ folder, ...module.default });
  }
  return cases;
}

/**
 * Runs one case. Returns { lines, failures }: the transcript as Markdown lines, and
 * a list of steps that didn't match their expectations.
 */
export async function runCase(testCase) {
  const db = await startSupabaseDb();
  const lines = [`# Transcript: ${testCase.title}`, "", `Case: ${testCase.link}`, ""];
  const failures = [];

  try {
    if (testCase.setup) {
      for (const block of testCase.setup) {
        const result = await db.run(block.sql, block);
        if (!result.ok) throw new Error(`setup failed (${describeIdentity(block)}): ${result.error.message}`);
      }
      lines.push("The case's setup ran first. See `setup` in case.js.", "");
    }

    for (const [index, step] of testCase.steps.entries()) {
      lines.push(`## ${index + 1}. ${step.title}`, "");
      if (step.whoSees) {
        const results = await db.whoSees(step.sql, step.whoSees);
        lines.push(`Run as each of: ${results.map((r) => `\`${r.identity}\``).join(", ")}`, "", "```sql", step.sql.trim(), "```", "");
        lines.push("| Who | What they get |", "|---|---|");
        for (const result of results) {
          lines.push(`| ${result.identity} | ${summarise(result).replace(/\|/g, "\\|")} |`);
          const expected = step.expect?.[result.identity];
          const problem = expected === undefined ? null : check(result, expected);
          if (problem) failures.push(`${testCase.folder} step ${index + 1} as ${result.identity}: ${problem}`);
        }
        lines.push("");
      } else {
        const result = await db.run(step.sql, step);
        lines.push(`As \`${describeIdentity(step)}\`:`, "", "```sql", step.sql.trim(), "```", "", ...formatResult(result), "");
        const problem = step.expect ? check(result, step.expect) : null;
        if (problem) failures.push(`${testCase.folder} step ${index + 1}: ${problem}`);
      }
    }
  } finally {
    await db.close();
  }

  lines.push(failures.length ? `**${failures.length} step(s) did not behave as expected.**` : "Every step behaved as the case expects.");
  return { lines, failures };
}

/** Compares a result with an expectation. Returns a problem description, or null. */
function check(result, expected) {
  if (typeof expected === "number") {
    return result.ok && result.rows.length === expected ? null : `expected ${expected} rows, got ${summarise(result)}`;
  }
  if (expected instanceof RegExp) {
    return !result.ok && expected.test(result.error.message) ? null : `expected an error matching ${expected}, got ${summarise(result)}`;
  }
  if (expected.ok !== undefined && result.ok !== expected.ok) {
    return `expected ${expected.ok ? "success" : "an error"}, got ${summarise(result)}`;
  }
  if (expected.error && !(result.error && expected.error.test(result.error.message))) {
    return `expected an error matching ${expected.error}, got ${summarise(result)}`;
  }
  if (expected.notice && !result.notices.some((notice) => expected.notice.test(notice))) {
    return `expected a notice matching ${expected.notice}, got ${JSON.stringify(result.notices)}`;
  }
  if (expected.rows && JSON.stringify(result.rows) !== JSON.stringify(expected.rows)) {
    return `expected rows ${JSON.stringify(expected.rows)}, got ${JSON.stringify(result.rows)}`;
  }
  return null;
}

/** One line describing a result, for tables and failure messages. */
function summarise(result) {
  if (!result.ok) return `error: ${result.error.message}`;
  if (!result.rows.length) return "no rows";
  return result.rows.map((row) => Object.values(row).map(display).join(", ")).join("; ");
}

/** A result as Markdown: rows as a table, then any error and notices. */
function formatResult(result) {
  const out = [];
  if (result.ok && result.rows.length) {
    const columns = Object.keys(result.rows[0]);
    out.push(`| ${columns.join(" | ")} |`, `|${columns.map(() => "---").join("|")}|`);
    for (const row of result.rows) out.push(`| ${columns.map((column) => display(row[column]).replace(/\|/g, "\\|")).join(" | ")} |`);
  } else if (result.ok) {
    out.push("Succeeded, with no rows returned.");
  } else {
    out.push(`**Error:** \`${result.error.message}\`${result.error.code ? ` (SQLSTATE ${result.error.code})` : ""}`);
  }
  if (result.notices.length) {
    const unique = [...new Set(result.notices)];
    // REVOKE warns once per column too. Keep the first few, and count the rest.
    const shown = unique.slice(0, 2);
    out.push("", "Notices:", "", ...shown.map((notice) => `- \`${notice}\``));
    if (unique.length > shown.length) out.push(`- ...and ${unique.length - shown.length} more like these, one for each column`);
  }
  return out;
}

function display(value) {
  if (value === null || value === undefined) return "null";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

// Command line --------------------------------------------------------------------

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const write = args.includes("--write");
  const filter = args.find((arg) => !arg.startsWith("--")) ?? "";
  const cases = await loadCases(filter);
  if (!cases.length) {
    console.error(`No case folder matches "${filter}".`);
    process.exit(2);
  }

  let failed = 0;
  for (const testCase of cases) {
    const { lines, failures } = await runCase(testCase);
    console.log(lines.join("\n"), "\n");
    if (write) writeFileSync(new URL(`${testCase.folder}/transcript.md`, CASES_DIR), lines.join("\n") + "\n");
    for (const failure of failures) console.error(`FAILED: ${failure}`);
    failed += failures.length;
  }
  console.log(failed ? `${failed} step(s) failed.` : `All ${cases.length} case(s) behaved as expected.`);
  process.exit(failed ? 1 : 0);
}
