// Import this first in an entry point (src/server.js, src/db/migrate.js, the
// scripts that need keys): the encrypted config/credentials.enc goes into
// process.env, never over a variable that is already set (the shell and .env
// win). Missing file: nothing happens. File without a usable key, wrong key
// or altered file: one line on stderr and exit 1, no stack trace.
// Under `node --test` nothing is loaded: tests set their own environment
// (tests/helpers/env.js) and never see a developer's keys.
import { CredentialsError, credentialsStatus, loadCredentials } from "./credentialStore.js";

export { credentialsStatus, loadCredentials };

if (!process.env.NODE_TEST_CONTEXT && process.env.NODE_ENV !== "test") {
  try {
    loadCredentials();
  } catch (e) {
    if (!(e instanceof CredentialsError)) throw e;
    process.stderr.write(`${e.message}\n`);
    process.exit(1);
  }
}
