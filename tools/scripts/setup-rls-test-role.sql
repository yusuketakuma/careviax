-- =============================================================================
-- PH-OS: Non-superuser RLS proof role (TEST / CI ONLY — never prod)
-- Purpose:
--   Provision a dedicated LOGIN role that is NOSUPERUSER + NOBYPASSRLS so it is
--   genuinely subject to PostgreSQL FORCE ROW LEVEL SECURITY. The E2E/dev DB
--   super role (ph_os) BYPASSES FORCE RLS, so a tenant-isolation assertion run
--   under ph_os would pass vacuously and overclaim isolation. This role closes
--   that proof gap (see .agent-loop/BLOCKED.md rls-force-nonsuperuser-proof and
--   src/lib/db/rls.test.ts "FORCE RLS non-superuser proof").
--
-- Safety:
--   Idempotent. Creates a weak, well-known test password on purpose — this role
--   is ONLY provisioned on throwaway CI service containers and the break-allowed
--   local E2E DB. It is NEVER created on production (the proof test is env-gated
--   on RLS_PROOF_DATABASE_URL and the production deploy job never sets it).
--
-- Usage:
--   psql "$RLS_PROOF_ADMIN_DATABASE_URL" -v ON_ERROR_STOP=1 -f tools/scripts/setup-rls-test-role.sql
--   (or `pnpm db:e2e:rls-proof-role`; the proof test also self-provisions via
--    its admin connection so no manual step is strictly required.)
--
-- The connection string used for RLS_PROOF_DATABASE_URL must match the password
-- set below, e.g. postgresql://ph_os_app:ph_os_app@<host>:<port>/<db>
-- =============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'ph_os_app') THEN
    CREATE ROLE ph_os_app
      LOGIN PASSWORD 'ph_os_app'
      NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT;
  ELSE
    -- Re-assert the security-relevant attributes so a pre-existing role can
    -- never silently drift into a superuser / bypassrls state that would make
    -- the proof vacuous.
    ALTER ROLE ph_os_app
      WITH LOGIN PASSWORD 'ph_os_app'
      NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END
$$;

-- Allow the role to connect to whichever database this script is applied to.
DO $$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO ph_os_app', current_database());
END
$$;

-- Minimum privileges to exercise tenant tables under RLS. RLS still filters
-- every row — these grants only make the tables reachable so the policy (not a
-- missing GRANT) is what denies cross-org access.
GRANT USAGE ON SCHEMA public TO ph_os_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ph_os_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ph_os_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ph_os_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO ph_os_app;
