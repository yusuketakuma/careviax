export type InventoryScope = {
  source_roots: string[];
  excluded_path_patterns: string[];
};

export type DiscoveredAuthzSurface = {
  detector: string;
  path: string;
  evidence_sha256: string;
};

export class AuthzInventoryError extends Error {
  readonly details: string[];
  constructor(message: string, details?: string[]);
}

export function assertNoUnsupportedRoleAccess(sourcePath: string, content: string): void;

export function discoverSurfaces(repoRoot: string, scope: InventoryScope): DiscoveredAuthzSurface[];

export type NonRuntimeAuthzContract = {
  path: string;
  classes: Array<'fixture' | 'seed' | 'test' | 'tooling'>;
  detectors: string[];
  sha256: string;
};

export function discoverNonRuntimeAuthzContracts(repoRoot: string): NonRuntimeAuthzContract[];

export type MigrationAuthzContract = {
  path: string;
  detectors: string[];
  defines_role_enum: boolean;
  defines_rls_contract: boolean;
  sha256: string;
};

export function discoverMigrationAuthzContracts(repoRoot: string): MigrationAuthzContract[];

export function sourceExactValues(
  detector: string,
  sourcePath: string,
  content: string,
  repoRoot?: string,
): string[];

export function sourceRouteMethodPurpose(
  sourcePath: string,
  content: string,
  detector?: string,
  repoRoot?: string,
): string;

export function parseApiPermissionContracts(
  sourcePath: string,
  content: string,
  repoRoot?: string,
): Array<{ method: string; permissions: string[] }>;

export function sourceTestRefs(repoRoot: string, sourcePath: string): string[];

export function checkInventory(options?: {
  repoRoot?: string;
  manifestPath?: string;
  validateBrowser?: boolean;
}): {
  entries: number;
  digest: string;
  detectors: number;
  browserAssets: number;
  browserScenarios: number;
  nonRuntimeContracts: number;
  migrationContracts: number;
};

export function discoverBrowserAssets(repoRoot: string): Array<{ path: string; sha256: string }>;

export type BrowserScenario = {
  path: string;
  suite: string;
  title: string;
  modifier: string;
};

export function discoverBrowserFreeze(repoRoot: string): {
  assets: Array<{ path: string; sha256: string }>;
  scenarios: BrowserScenario[];
};

export function discoverBrowserScenarios(repoRoot: string): BrowserScenario[];

export function validateBrowserFreeze(
  repoRoot: string,
  gate: {
    asset_baseline: Array<{ path: string; sha256: string }>;
    scenario_baseline: BrowserScenario[];
  },
): void;

export function parsePhosRouteContracts(content: string): Array<{
  route_key: string;
  method: string;
  purpose: string;
  required_scopes: string[];
  allowed_roles: string[];
}>;
