// Releases (_product/docs/git.md, Releases): the workflow a pushed vX.Y.Z tag runs
// (.github/workflows/release.yml) and the version check of make release, which refuses
// a malformed name before any git or GitHub call. No network, no tag is created.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { parse } from "yaml";

const root = new URL("../", import.meta.url);
const source = (name) => readFileSync(new URL(`.github/workflows/${name}`, root), "utf8");
const workflow = (name) => parse(source(name));
const step = (steps, action) => steps.find((s) => s.uses?.startsWith(action));

test("a pushed vX.Y.Z tag publishes a GitHub release with generated notes and the APK named after the tag", () => {
  const release = workflow("release.yml");
  assert.deepEqual(release.on, { push: { tags: ["v*"] } });
  const build = release.jobs.apk.steps.find((s) => /assembleDebug/.test(s.run ?? ""));
  assert.match(build.run, /mv app\/build\/outputs\/apk\/debug\/\*\.apk "\.\.\/prudence-\$\{GITHUB_REF_NAME\}-android-debug\.apk"/);
  assert.doesNotMatch(build.run, /testDebugUnitTest/, "CI already ran the unit tests on the tagged commit");
  assert.equal(step(release.jobs.apk.steps, "actions/upload-artifact@").with.path, "prudence-${{ github.ref_name }}-android-debug.apk");
  const publish = step(release.jobs.publish.steps, "softprops/action-gh-release@");
  assert.equal(publish.with.generate_release_notes, true);
  assert.equal(publish.with.files, "prudence-${{ github.ref_name }}-android-debug.apk");
  assert.equal(publish.with.fail_on_unmatched_files, true, "a missing APK fails the release instead of publishing it empty");
  assert.match(publish.with.body, /^Debug build of the Prudence companion app; the web app runs from the repo/);
  assert.equal(publish.with.prerelease, "${{ contains(github.ref_name, '-') }}", "v1.2.3-rc1 is a pre-release, never Latest");
});

test("only the publish job can write to the repository; the build never holds a write token", () => {
  const release = workflow("release.yml");
  assert.deepEqual(release.permissions, { contents: "read" });
  assert.equal(release.jobs.apk.permissions, undefined, "the build job keeps the read-only default");
  assert.deepEqual(release.jobs.publish.permissions, { contents: "write" });
  assert.equal(release.jobs.publish.needs, "apk");
  for (const s of release.jobs.publish.steps) assert.equal(s.run, undefined, "the publish job runs no shell and no project code");
  assert.equal(step(release.jobs.apk.steps, "actions/checkout@").with["persist-credentials"], false, "no token left in .git/config");
  for (const s of release.jobs.apk.steps) assert.doesNotMatch(s.run ?? "", /\$\{\{/, "the tag name reaches a shell only through GITHUB_REF_NAME");
});

test("third-party actions in the release workflow are pinned to a full commit SHA with the version beside it", () => {
  const uses = [...source("release.yml").matchAll(/^\s+- uses: (\S+)(.*)$/gm)].filter(([, action]) => !action.startsWith("actions/"));
  assert.deepEqual(uses.map(([, action]) => action.split("@")[0]), ["gradle/actions/setup-gradle", "softprops/action-gh-release"]);
  for (const [, action, comment] of uses) {
    assert.match(action, /@[0-9a-f]{40}$/, `${action} is pinned to a commit`);
    assert.match(comment, /^ # v\d+\.\d+\.\d+$/, `${action} names its version`);
  }
});

test("the release APK is built with the same actions, versions and JDK as CI's Android job", () => {
  const ci = workflow("ci.yml").jobs.android.steps;
  const apk = workflow("release.yml").jobs.apk.steps;
  for (const { uses } of apk.filter((s) => s.uses)) {
    const name = uses.split("@")[0];
    const twin = ci.find((s) => s.uses?.split("@")[0] === name);
    assert.ok(twin, `${name} is used by CI's Android job too`);
    assert.equal(uses, twin.uses, `${name}: release.yml and ci.yml use the same version (bump both together)`);
  }
  assert.ok(step(apk, "gradle/actions/setup-gradle@"), "the Gradle cache");
  assert.deepEqual(step(apk, "actions/setup-java@").with, step(ci, "actions/setup-java@").with);
});

test("make release refuses a malformed version before touching git or GitHub", async () => {
  const env = { ...process.env, MAKEFLAGS: "", MAKELEVEL: "", MFLAGS: "" };
  const run = (version) => new Promise((resolve) => execFile("make", ["-s", "release", `VERSION=${version}`],
    { cwd: root, env, timeout: 20000 }, (err, stdout) => resolve({ code: err ? err.code : 0, stdout })));
  for (const version of ["", "1.0.0", "v1.0", "v1.0.0-RC1", "v1.0.0;id", "v1.0.0 x", "v1.0.0.1"]) {
    const { code, stdout } = await run(version);
    assert.notEqual(code, 0, `VERSION=${version} is refused`);
    assert.match(stdout, /^Name the version: make release VERSION=v1\.2\.3/, `VERSION=${version}`);
  }
});
