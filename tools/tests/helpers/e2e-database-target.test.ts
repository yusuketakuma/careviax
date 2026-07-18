import { afterEach, describe, expect, it } from 'vitest';
import { localPlaywrightDatabaseConnectionString } from './e2e-database-target';

const SAFE_DATABASE_URL = 'postgresql://ph_os:ph_os@localhost:5433/ph_os_e2e?schema=public';

const originalEnvironment = {
  playwright: process.env.PLAYWRIGHT,
  playwrightReuseServer: process.env.PLAYWRIGHT_REUSE_SERVER,
  databaseUrl: process.env.DATABASE_URL,
  directUrl: process.env.DIRECT_URL,
};

function restoreEnvironment(name: keyof typeof originalEnvironment, environmentName: string) {
  const value = originalEnvironment[name];
  if (value === undefined) delete process.env[environmentName];
  else process.env[environmentName] = value;
}

afterEach(() => {
  restoreEnvironment('playwright', 'PLAYWRIGHT');
  restoreEnvironment('playwrightReuseServer', 'PLAYWRIGHT_REUSE_SERVER');
  restoreEnvironment('databaseUrl', 'DATABASE_URL');
  restoreEnvironment('directUrl', 'DIRECT_URL');
});

describe('localPlaywrightDatabaseConnectionString', () => {
  it('returns a query-free connection string only for the dedicated local E2E target', () => {
    process.env.PLAYWRIGHT = '1';
    process.env.DATABASE_URL = SAFE_DATABASE_URL;
    process.env.DIRECT_URL = SAFE_DATABASE_URL;

    expect(localPlaywrightDatabaseConnectionString('Fixture setup')).toBe(
      'postgresql://ph_os:ph_os@localhost:5433/ph_os_e2e',
    );
  });

  it('fails before a fixture can connect when the Playwright guard or explicit URLs are absent', () => {
    delete process.env.PLAYWRIGHT;
    delete process.env.PLAYWRIGHT_REUSE_SERVER;
    process.env.DATABASE_URL = SAFE_DATABASE_URL;
    process.env.DIRECT_URL = SAFE_DATABASE_URL;
    expect(() => localPlaywrightDatabaseConnectionString('Fixture setup')).toThrow(
      /requires PLAYWRIGHT=1 or PLAYWRIGHT_REUSE_SERVER=1/,
    );

    process.env.PLAYWRIGHT = '1';
    delete process.env.DATABASE_URL;
    expect(() => localPlaywrightDatabaseConnectionString('Fixture setup')).toThrow(
      /requires explicit DATABASE_URL and DIRECT_URL/,
    );
  });

  it('rejects an unsafe target, query override, or DATABASE_URL and DIRECT_URL mismatch', () => {
    process.env.PLAYWRIGHT_REUSE_SERVER = '1';
    process.env.DIRECT_URL = SAFE_DATABASE_URL;

    for (const databaseUrl of [
      'postgresql://ph_os:ph_os@localhost:5433/ph-os_dev?schema=public',
      `${SAFE_DATABASE_URL}&host=example.invalid`,
      'postgresql://ph_os:ph_os@127.0.0.1:5433/ph_os_e2e?schema=public',
    ]) {
      process.env.DATABASE_URL = databaseUrl;
      expect(() => localPlaywrightDatabaseConnectionString('Fixture setup')).toThrow();
    }
  });
});
