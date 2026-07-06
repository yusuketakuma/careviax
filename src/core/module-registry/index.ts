import moduleIds from './module-ids.json';

const FEATURE_MODULES = moduleIds.featureModules;

export type PhosFeatureModuleId = 'pharmacy' | 'home_medical' | 'home_nursing' | 'network_ops';
export const PHOS_FEATURE_MODULE_IDS = FEATURE_MODULES.map(
  (moduleMeta) => moduleMeta.id,
) as readonly PhosFeatureModuleId[];
export type PhosModuleId = 'core' | PhosFeatureModuleId;

export type PhosTenantScope =
  | 'global'
  | 'org'
  | 'org_case'
  | 'cross_tenant_grant'
  | 'platform_support';

export type PhosPhiBoundary = 'none' | 'metadata_only' | 'phi_present' | 'external_output';

export type PhosRegistryReference =
  | `risk:${string}`
  | `task:${string}`
  | `event:${string}`
  | `dto:${string}`
  | `route:${string}`
  | `rls:${string}`
  | `audit:${string}`;

export type PhosModuleMetadata = Readonly<{
  id: PhosFeatureModuleId;
  label: string;
  enabled: boolean;
  ownedModels: readonly string[];
  routePrefixes: readonly string[];
  publicServices: readonly string[];
  riskDomainsRef: readonly PhosRegistryReference[];
  taskRegistryRef: readonly PhosRegistryReference[];
  emittedEventsRef: readonly PhosRegistryReference[];
  tenantScope: readonly PhosTenantScope[];
  phiBoundary: PhosPhiBoundary;
  notes?: readonly string[];
}>;

export function definePhosModule<const TModule extends PhosModuleMetadata>(
  moduleMeta: TModule,
): Readonly<TModule> {
  return Object.freeze(moduleMeta);
}

export function assertUniquePhosModules(modules: readonly PhosModuleMetadata[]): void {
  const seen = new Set<PhosFeatureModuleId>();
  for (const moduleMeta of modules) {
    if (seen.has(moduleMeta.id)) {
      throw new Error(`Duplicate PH-OS module id: ${moduleMeta.id}`);
    }
    seen.add(moduleMeta.id);
  }
}

export function listEnabledPhosModules(
  modules: readonly PhosModuleMetadata[],
): readonly PhosModuleMetadata[] {
  assertUniquePhosModules(modules);
  return modules.filter((moduleMeta) => moduleMeta.enabled);
}
