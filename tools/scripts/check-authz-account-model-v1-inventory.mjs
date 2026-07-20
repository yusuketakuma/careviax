#!/usr/bin/env node

import { pathToFileURL } from 'node:url';

import {
  AuthzInventoryError,
  assert,
  DEFAULT_MANIFEST_PATH,
  readRepoFile,
} from './authz-account-model-v1-inventory/core.mjs';
import {
  discoverBrowserAssets,
  discoverBrowserScenarios,
} from './authz-account-model-v1-inventory/browser-freeze.mjs';
import { checkInventory } from './authz-account-model-v1-inventory/inventory-check.mjs';
import {
  discoverMigrationAuthzContracts,
  discoverSurfaces,
} from './authz-account-model-v1-inventory/surface-discovery.mjs';

export { AuthzInventoryError } from './authz-account-model-v1-inventory/core.mjs';
export { parseApiPermissionContracts } from './authz-account-model-v1-inventory/api-permission-contracts.mjs';
export {
  discoverBrowserAssets,
  discoverBrowserScenarios,
  validateBrowserFreeze,
} from './authz-account-model-v1-inventory/browser-freeze.mjs';
export { checkInventory } from './authz-account-model-v1-inventory/inventory-check.mjs';
export {
  assertNoUnsupportedRoleAccess,
  discoverMigrationAuthzContracts,
  discoverNonRuntimeAuthzContracts,
  discoverSurfaces,
  parsePhosRouteContracts,
  sourceExactValues,
  sourceRouteMethodPurpose,
  sourceTestRefs,
} from './authz-account-model-v1-inventory/surface-discovery.mjs';

function parseArgs(argv) {
  const options = {
    manifestPath: DEFAULT_MANIFEST_PATH,
    printDiscoveryCandidates: false,
    printBrowserFreeze: false,
    printMigrationContracts: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--manifest') {
      options.manifestPath = argv[++index];
      assert(options.manifestPath, '--manifest requires a path');
    } else if (argument === '--print-discovery-candidates') {
      options.printDiscoveryCandidates = true;
    } else if (argument === '--print-browser-freeze') {
      options.printBrowserFreeze = true;
    } else if (argument === '--print-migration-contracts') {
      options.printMigrationContracts = true;
    } else {
      throw new AuthzInventoryError(`unknown argument: ${argument}`);
    }
  }
  return options;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const repoRoot = process.cwd();
  if (options.printDiscoveryCandidates) {
    const manifest = JSON.parse(readRepoFile(repoRoot, options.manifestPath, 'manifest'));
    process.stdout.write(
      `${JSON.stringify(discoverSurfaces(repoRoot, manifest.scope), null, 2)}\n`,
    );
    return;
  }
  if (options.printBrowserFreeze) {
    process.stdout.write(
      `${JSON.stringify({ asset_baseline: discoverBrowserAssets(repoRoot), scenario_baseline: discoverBrowserScenarios(repoRoot) }, null, 2)}\n`,
    );
    return;
  }
  if (options.printMigrationContracts) {
    process.stdout.write(`${JSON.stringify(discoverMigrationAuthzContracts(repoRoot), null, 2)}\n`);
    return;
  }
  const result = checkInventory({ repoRoot, manifestPath: options.manifestPath });
  process.stdout.write(
    `authz account model v1 inventory passed: entries=${result.entries}, detectors=${result.detectors}, browser_assets=${result.browserAssets}, browser_scenarios=${result.browserScenarios}, non_runtime_contracts=${result.nonRuntimeContracts}, migration_contracts=${result.migrationContracts}, sha256=${result.digest}\n`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    main();
  } catch (error) {
    if (error instanceof AuthzInventoryError) {
      console.error(`authz account model v1 inventory failed: ${error.message}`);
      for (const detail of error.details) console.error(`- ${detail}`);
      process.exitCode = 1;
    } else {
      throw error;
    }
  }
}
