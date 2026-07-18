import { assertMatchingE2eTargets } from '../../scripts/prepare-e2e-db-core';

export function localPlaywrightDatabaseConnectionString(scope: string) {
  if (process.env.PLAYWRIGHT !== '1' && process.env.PLAYWRIGHT_REUSE_SERVER !== '1') {
    throw new Error(`${scope} requires PLAYWRIGHT=1 or PLAYWRIGHT_REUSE_SERVER=1`);
  }

  const databaseUrl = process.env.DATABASE_URL;
  const directUrl = process.env.DIRECT_URL;
  if (!databaseUrl || !directUrl) {
    throw new Error(`${scope} requires explicit DATABASE_URL and DIRECT_URL`);
  }

  assertMatchingE2eTargets(databaseUrl, directUrl);
  const connectionUrl = new URL(databaseUrl);
  connectionUrl.search = '';
  return connectionUrl.toString();
}
