// Import this first in an entry point (src/server.js, src/db/migrate.js, the
// scripts that need keys): `.env` in the working directory (when there is one),
// then the encrypted config/credentials.enc go into process.env, never over a
// variable that is already set (the shell wins over .env, both over the
// credentials). The loader reads .env itself rather than through node's
// --env-file-if-exists: with that flag, watch mode (make server) watches the
// repo root recursively and restarts on every .git write by another session.
// Missing file: nothing happens. File without a usable key, wrong key
// or altered file: one line on stderr and exit 1, no stack trace.
// Under `node --test` nothing is loaded: tests set their own environment
// (tests/helpers/env.js) and never see a developer's keys.
import { existsSync } from "node:fs";
import { CredentialsError, credentialsStatus, loadCredentials } from "./credentialStore.js";

export { credentialsStatus, loadCredentials };

if (!process.env.NODE_TEST_CONTEXT && process.env.NODE_ENV !== "test") {
  if (existsSync(".env")) process.loadEnvFile(".env");
  try {
    loadCredentials();
  } catch (e) {
    if (!(e instanceof CredentialsError)) throw e;
    // A teammate who has not received the master key yet still runs on their
    // own environment and .env: one warning line, then carry on. A wrong key,
    // an altered file, or a missing key in production still stop here.
    if (e.message.startsWith("No master key for ") && process.env.NODE_ENV !== "production") {
      process.stderr.write(`warning: ${e.message}. Running on your environment and .env only.\n`);
    } else {
      process.stderr.write(`${e.message}\n`);
      process.exit(1);
    }
  }
}
