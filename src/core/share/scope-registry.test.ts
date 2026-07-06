import { describe, expect, it } from 'vitest';
import { createShareScopeRegistry, type ShareScopeDefinition } from './scope-registry';

const definitions = [
  {
    key: 'visit_schedule',
    module: 'core',
    label: 'Visit schedule',
    description: 'Shares scoped visit schedules.',
    requiredPermission: 'canVisit',
    requiresCaseBoundary: true,
    outputRisk: 'medium',
  },
  {
    key: 'care_reports',
    module: 'core',
    label: 'Care reports',
    description: 'Shares scoped care report summaries.',
    requiredPermission: 'canSendCareReport',
    requiresCaseBoundary: true,
    requiresReportBoundary: true,
    outputRisk: 'high',
  },
  {
    key: 'medication_list',
    module: 'pharmacy',
    label: 'Medication list',
    description: 'Shares current medications.',
    requiredPermission: 'canVisit',
    requiresCaseBoundary: false,
    outputRisk: 'high',
  },
] as const satisfies readonly ShareScopeDefinition[];

describe('createShareScopeRegistry', () => {
  it('indexes definitions and derives boundary groups', () => {
    const registry = createShareScopeRegistry(definitions);

    expect(registry.keys()).toEqual(['visit_schedule', 'care_reports', 'medication_list']);
    expect(registry.get('care_reports')).toMatchObject({
      module: 'core',
      requiredPermission: 'canSendCareReport',
      outputRisk: 'high',
    });
    expect(registry.get('unknown')).toBeNull();
    expect(registry.caseBoundaryKeys()).toEqual(['visit_schedule', 'care_reports']);
    expect(registry.patientLevelKeys()).toEqual(['medication_list']);
    expect(registry.reportBoundaryKeys()).toEqual(['care_reports']);
  });

  it('fails closed when a required scope is not registered', () => {
    const registry = createShareScopeRegistry(definitions);

    expect(() => registry.require('unknown')).toThrow('Share scope is not registered: unknown');
  });

  it('rejects duplicate scope keys', () => {
    expect(() =>
      createShareScopeRegistry([
        definitions[0],
        {
          ...definitions[0],
          label: 'Duplicate visit schedule',
        },
      ]),
    ).toThrow('Duplicate share scope definition: visit_schedule');
  });
});
