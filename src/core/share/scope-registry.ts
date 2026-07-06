import type { PhosModuleId } from '@/core/module-registry';

export type ShareScopeOutputRisk = 'low' | 'medium' | 'high';

export type ShareScopeDefinition<
  TKey extends string = string,
  TPermission extends string = string,
> = Readonly<{
  key: TKey;
  module: PhosModuleId;
  label: string;
  description: string;
  requiredPermission: TPermission;
  requiresCaseBoundary: boolean;
  requiresReportBoundary?: boolean;
  outputRisk: ShareScopeOutputRisk;
}>;

export type ShareScopeRegistry<
  TKey extends string = string,
  TPermission extends string = string,
> = Readonly<{
  get(key: string): ShareScopeDefinition<TKey, TPermission> | null;
  require(key: string): ShareScopeDefinition<TKey, TPermission>;
  keys(): readonly TKey[];
  definitions(): readonly ShareScopeDefinition<TKey>[];
  caseBoundaryKeys(): readonly TKey[];
  patientLevelKeys(): readonly TKey[];
  reportBoundaryKeys(): readonly TKey[];
}>;

export function createShareScopeRegistry<const TDefinition extends readonly ShareScopeDefinition[]>(
  definitions: TDefinition,
): ShareScopeRegistry<TDefinition[number]['key'], TDefinition[number]['requiredPermission']> {
  const byKey = new Map<string, TDefinition[number]>();

  for (const definition of definitions) {
    if (byKey.has(definition.key)) {
      throw new Error(`Duplicate share scope definition: ${definition.key}`);
    }
    byKey.set(definition.key, definition);
  }

  const keys = Object.freeze(Array.from(byKey.keys())) as readonly TDefinition[number]['key'][];
  const frozenDefinitions = Object.freeze([...definitions]);
  const caseBoundaryKeys = Object.freeze(
    frozenDefinitions
      .filter((definition) => definition.requiresCaseBoundary)
      .map((definition) => definition.key),
  ) as readonly TDefinition[number]['key'][];
  const patientLevelKeys = Object.freeze(
    frozenDefinitions
      .filter((definition) => !definition.requiresCaseBoundary)
      .map((definition) => definition.key),
  ) as readonly TDefinition[number]['key'][];
  const reportBoundaryKeys = Object.freeze(
    frozenDefinitions
      .filter((definition) => definition.requiresReportBoundary === true)
      .map((definition) => definition.key),
  ) as readonly TDefinition[number]['key'][];

  return Object.freeze({
    get(key: string) {
      return byKey.get(key) ?? null;
    },
    require(key: string) {
      const definition = byKey.get(key);
      if (!definition) {
        throw new Error(`Share scope is not registered: ${key}`);
      }
      return definition;
    },
    keys() {
      return keys;
    },
    definitions() {
      return frozenDefinitions;
    },
    caseBoundaryKeys() {
      return caseBoundaryKeys;
    },
    patientLevelKeys() {
      return patientLevelKeys;
    },
    reportBoundaryKeys() {
      return reportBoundaryKeys;
    },
  });
}
