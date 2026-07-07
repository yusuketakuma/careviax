import { describe, expect, it, vi } from 'vitest';
import { createRiskFinding } from '@/lib/risk/risk-finding';
import { createRiskFindingProviderRegistry } from './provider-registry';

describe('createRiskFindingProviderRegistry', () => {
  it('returns providers by id and preserves collection order', () => {
    const firstCollect = vi.fn().mockReturnValue([
      createRiskFinding({
        key: 'first',
        domain: 'patient_foundation',
        severity: 'warning',
        title: 'First',
        detail: 'First detail',
        action_href: '/first',
        action_label: 'First',
      }),
    ]);
    const secondCollect = vi.fn().mockReturnValue([
      createRiskFinding({
        key: 'second',
        domain: 'medication',
        severity: 'warning',
        title: 'Second',
        detail: 'Second detail',
        action_href: '/second',
        action_label: 'Second',
      }),
    ]);
    const input = { caseId: 'case_1' };

    const registry = createRiskFindingProviderRegistry([
      {
        module: 'core',
        providerId: 'core.first',
        domains: ['patient_foundation'],
        collect: firstCollect,
      },
      {
        module: 'pharmacy',
        providerId: 'pharmacy.second',
        domains: ['medication'],
        collect: secondCollect,
      },
    ]);

    expect(registry.get('core.first')?.providerId).toBe('core.first');
    expect(registry.providerIds()).toEqual(['core.first', 'pharmacy.second']);
    expect(registry.collectAll(input).map((finding) => finding.key)).toEqual(['first', 'second']);
    expect(firstCollect).toHaveBeenCalledWith(input);
    expect(secondCollect).toHaveBeenCalledWith(input);
  });

  it('rejects duplicate provider ids', () => {
    expect(() =>
      createRiskFindingProviderRegistry([
        {
          module: 'core',
          providerId: 'core.duplicate',
          domains: ['patient_foundation'],
          collect: () => [],
        },
        {
          module: 'core',
          providerId: 'core.duplicate',
          domains: ['task_sla'],
          collect: () => [],
        },
      ]),
    ).toThrow(/Duplicate risk finding provider: core\.duplicate/);
  });

  it('fails soft when one provider throws and keeps other provider findings', () => {
    const registry = createRiskFindingProviderRegistry([
      {
        module: 'core',
        providerId: 'core.throwing',
        domains: ['patient_foundation'],
        collect: () => {
          throw new Error('provider unavailable');
        },
      },
      {
        module: 'pharmacy',
        providerId: 'pharmacy.ok',
        domains: ['medication'],
        collect: () => [
          createRiskFinding({
            key: 'ok',
            domain: 'medication',
            severity: 'warning',
            title: 'OK',
            detail: 'OK detail',
            action_href: '/ok',
            action_label: 'OK',
          }),
        ],
      },
    ]);

    expect(registry.collectAll({ caseId: 'case_1' }).map((finding) => finding.key)).toEqual(['ok']);
  });
});
