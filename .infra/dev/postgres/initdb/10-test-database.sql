-- First start of the compose Postgres only (docker-entrypoint-initdb.d): the test
-- database next to scam_shield (POSTGRES_DB). Per-agent copies (scam_shield_test_<suffix>)
-- are created by tests/helpers/db.js on first use; make db-test-clean drops them.
CREATE DATABASE scam_shield_test;
