// The one-click path (.devcontainer/devcontainer.json; _product/docs/infra.md, Codespaces;
// _product/docs/dx.md, Try it without keys): the container's Node is the one of .nvmrc, Postgres
// is the dev compose through docker-in-docker, and in a Codespace the default BASE_URL is the
// forwarded address, so the demo's own POSTs pass the Origin check (src/server.js) with no setting.
import "./helpers/env.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { defaultBaseUrl } from "../src/config.js";

const root = new URL("../", import.meta.url);
const read = (p) => readFileSync(new URL(p, root), "utf8");
// devcontainer.json takes comments; this one keeps them on lines of their own.
const devcontainer = JSON.parse(read(".devcontainer/devcontainer.json").split("\n").filter((l) => !l.trim().startsWith("//")).join("\n"));
const CODESPACE = { CODESPACE_NAME: "judge-x7q", GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN: "app.github.dev" };

test("the default address: localhost, or the forwarded one in a Codespace; never half a Codespace", () => {
  assert.equal(defaultBaseUrl({}), "http://localhost:3000");
  assert.equal(defaultBaseUrl({ PORT: "3207" }), "http://localhost:3207");
  assert.equal(defaultBaseUrl(CODESPACE), "https://judge-x7q-3000.app.github.dev");
  assert.equal(defaultBaseUrl({ ...CODESPACE, PORT: "3100" }), "https://judge-x7q-3100.app.github.dev");
  assert.equal(defaultBaseUrl({ CODESPACE_NAME: "judge-x7q" }), "http://localhost:3000");
});

test("config in a Codespace: the forwarded https address and secure cookies, and BASE_URL still wins", () => {
  const baseUrl = (env) => execFileSync(process.execPath, ["--input-type=module", "-e",
    "const { config } = await import('./src/config.js'); console.log(JSON.stringify([config.baseUrl, config.secureCookies]))"],
  { cwd: root, env: { PATH: process.env.PATH, ...env }, encoding: "utf8" });
  assert.deepEqual(JSON.parse(baseUrl(CODESPACE)), ["https://judge-x7q-3000.app.github.dev", true]);
  assert.deepEqual(JSON.parse(baseUrl({ ...CODESPACE, BASE_URL: "https://heyprudence.com/" })), ["https://heyprudence.com", true]);
  assert.deepEqual(JSON.parse(baseUrl({})), ["http://localhost:3000", false]);
});

test("the devcontainer: Node of .nvmrc, Docker for the compose Postgres, databases once, the app on the forwarded port", () => {
  const node = read(".nvmrc").trim();
  assert.match(devcontainer.image, new RegExp(`^mcr\\.microsoft\\.com/devcontainers/javascript-node:${node}-bookworm$`),
    ".nvmrc's Node on bookworm: the bare tag is Debian trixie, where docker-in-docker cannot install Moby");
  const [dind, options] = Object.entries(devcontainer.features).find(([k]) => k.includes("/docker-in-docker:")) || [];
  assert.ok(dind, "docker-in-docker: make db-up runs the dev compose inside the container");
  assert.equal(options.dockerDashComposeVersion, "v2");
  assert.match(devcontainer.postCreateCommand, /^npm ci\b.*&& make db-up$/);
  assert.equal(devcontainer.postAttachCommand, "make server");
  assert.deepEqual(devcontainer.forwardPorts, [3000]);
  assert.equal(devcontainer.portsAttributes["3000"].label, "Prudence");
  // As in CI: compose's superuser (PG_USER) is the user every client connects as (PGUSER).
  assert.deepEqual(devcontainer.containerEnv, { PG_USER: "postgres", PGUSER: "postgres" });
  assert.deepEqual(Object.keys(devcontainer.features), [dind], "no Java or Android SDK: the companion app is not part of the one-click path");
});
