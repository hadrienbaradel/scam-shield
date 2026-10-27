// scripts/doctor.mjs: says what is missing, never a secret value.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { describeDbUrl, minVersion, versionGte, parseEnvFile, WORKING_NODE } from "../scripts/doctor.mjs";

const doctor = new URL("../scripts/doctor.mjs", import.meta.url).pathname;
// Resolves with { code, output } whatever the exit code.
const run = (args, env) => new Promise((resolve) => {
  execFile(process.execPath, [doctor, ...args], { env: { ...process.env, ...env }, timeout: 20000 },
    (err, stdout, stderr) => resolve({ code: err ? err.code : 0, output: `${stdout}${stderr}` }));
});

test("database addresses are shown without credentials", () => {
  const shown = describeDbUrl("postgres://alice:S3CRET@db.internal:6543/scam_shield?sslmode=require");
  assert.equal(shown, "db.internal:6543/scam_shield");
  assert.equal(describeDbUrl("postgres://localhost/scam_shield_test"), "localhost:5432/scam_shield_test");
  assert.doesNotMatch(describeDbUrl("not a url at all"), /not a url/);
});

test("engines ranges resolve to their lowest version", () => {
  assert.equal(minVersion(">=20"), "20.0.0");
  assert.equal(minVersion("^22.5.1"), "22.5.1");
  assert.equal(minVersion("22.x"), "22.0.0");
  assert.equal(minVersion(""), "0.0.0");
  assert.ok(versionGte("25.6.0", WORKING_NODE));
  assert.ok(!versionGte("22.8.0", WORKING_NODE));
  assert.ok(versionGte("22.9.0", "22.9.0"));
});

test(".env lines are read for presence only", () => {
  const m = parseEnvFile(`# comment\nPORT=3000\nexport HOST="0.0.0.0"\nEMPTY=\n# META_MODEL_API_KEY=commented\nMETA_MODEL_API_KEY='k'\nnot a line\n`);
  assert.deepEqual([...m.keys()], ["PORT", "HOST", "EMPTY", "META_MODEL_API_KEY"]);
  assert.equal(m.get("HOST"), "0.0.0.0");
  assert.equal(m.get("EMPTY"), "");
});

test("an unreachable database is one line with the fix, and no credential from the URL", async () => {
  const env = {
    DATABASE_URL: "postgres://alice:S3CRET-PASS@127.0.0.1:1/scam_shield",
    TEST_DATABASE_URL: "postgres://bob:T0P-SECRET@127.0.0.1:1/scam_shield_test",
  };
  const { code, output } = await run(["db", "testdb", "--quiet"], env);
  assert.equal(code, 1, output);
  assert.match(output, /FAIL  Postgres not reachable at 127\.0\.0\.1:1\/scam_shield .*make db-up/);
  assert.match(output, /WARN  test database not reachable at 127\.0\.0\.1:1\/scam_shield_test .*integration tests skip/);
  assert.equal(output.split("\n").filter(Boolean).length, 2, "one line per problem, no stack trace");
  for (const secret of ["S3CRET-PASS", "T0P-SECRET", "alice", "bob"]) assert.ok(!output.includes(secret), `leaked ${secret}`);

  // A missing test database is only a warning (make test still runs) unless --strict (npm run check).
  const soft = await run(["testdb", "--quiet"], env);
  assert.equal(soft.code, 0, soft.output);
  const strict = await run(["testdb", "--quiet", "--strict"], env);
  assert.equal(strict.code, 1, strict.output);
  assert.match(strict.output, /^  FAIL  test database/);
});

test("configuration is reported by name and presence, never by value", async () => {
  const env = {
    TOKEN_ENC_KEY: Buffer.alloc(32, 7).toString("base64"),
    META_MODEL_API_KEY: "sk-DOCTOR-TEST-VALUE",
    GOOGLE_CLIENT_ID: "doctor-test-client.apps.googleusercontent.com",
    GOOGLE_CLIENT_SECRET: "GOCSPX-doctor-test-value",
    ABUSECH_AUTH_KEY: "abusech-doctor-test-value",
  };
  const { output } = await run(["env"], env);
  assert.match(output, /TOKEN_ENC_KEY present \(environment\)/);
  assert.match(output, /Muse Spark on \(META_MODEL_API_KEY present\)/);
  assert.match(output, /ABUSECH_AUTH_KEY present/);
  for (const value of Object.values(env)) assert.ok(!output.includes(value), `leaked a value: ${value.slice(0, 6)}…`);
});
