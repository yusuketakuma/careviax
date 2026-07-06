import { describe, expect, it } from 'vitest';

import {
  assertUniquePhosModules,
  listEnabledPhosModules,
  PHOS_FEATURE_MODULE_IDS,
} from '@/core/module-registry';
import moduleIds from '@/core/module-registry/module-ids.json';
import { activeModules } from '@/modules/active-modules';

describe('PH-OS module registry metadata', () => {
  it('keeps pharmacy as the only active feature module for the current product scope', () => {
    expect(moduleIds.featureModules).toEqual([
      { id: 'pharmacy', dir: 'pharmacy' },
      { id: 'home_medical', dir: 'home-medical' },
      { id: 'home_nursing', dir: 'home-nursing' },
      { id: 'network_ops', dir: 'network-ops' },
    ]);
    expect(PHOS_FEATURE_MODULE_IDS).toEqual([
      'pharmacy',
      'home_medical',
      'home_nursing',
      'network_ops',
    ]);
    expect(activeModules.map((module) => module.id)).toEqual(['pharmacy']);
    expect(listEnabledPhosModules(activeModules).map((module) => module.id)).toEqual(['pharmacy']);
  });

  it('keeps module metadata as references to existing registries, not duplicate task or risk semantics', () => {
    const [pharmacyModule] = activeModules;

    expect(pharmacyModule?.riskDomainsRef).toEqual([
      'risk:medication',
      'risk:dispensing',
      'risk:visit_preparation',
      'risk:billing',
    ]);
    expect(pharmacyModule?.taskRegistryRef).toEqual(['task:src/lib/tasks/task-registry.ts']);
    expect(pharmacyModule?.emittedEventsRef).toEqual([]);
  });

  it('fails closed on duplicate module ids', () => {
    const [pharmacyModule] = activeModules;
    expect(pharmacyModule).toBeDefined();

    expect(() => assertUniquePhosModules([pharmacyModule!, pharmacyModule!])).toThrow(
      'Duplicate PH-OS module id: pharmacy',
    );
  });
});
