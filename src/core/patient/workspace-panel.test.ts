import { describe, expect, it } from 'vitest';
import { createPatientWorkspacePanelRegistry } from './workspace-panel';

describe('createPatientWorkspacePanelRegistry', () => {
  it('collects non-null panels in provider order', async () => {
    const registry = createPatientWorkspacePanelRegistry([
      {
        module: 'pharmacy',
        panelId: 'pharmacy.empty',
        label: 'Empty',
        build: async () => null,
      },
      {
        module: 'pharmacy',
        panelId: 'pharmacy.current_medication_cycle',
        label: 'Current medication cycle',
        build: async (input: { patientId: string }) => ({
          patientId: input.patientId,
          panel: 'cycle',
        }),
      },
    ] as const);

    await expect(registry.collectAll({ patientId: 'patient_1' })).resolves.toEqual([
      { patientId: 'patient_1', panel: 'cycle' },
    ]);
    await expect(registry.buildFirst({ patientId: 'patient_1' })).resolves.toEqual({
      patientId: 'patient_1',
      panel: 'cycle',
    });
    expect(registry.panelIds()).toEqual(['pharmacy.empty', 'pharmacy.current_medication_cycle']);
  });

  it('rejects duplicate panel ids', () => {
    expect(() =>
      createPatientWorkspacePanelRegistry([
        {
          module: 'pharmacy',
          panelId: 'pharmacy.current_medication_cycle',
          label: 'A',
          build: async () => null,
        },
        {
          module: 'pharmacy',
          panelId: 'pharmacy.current_medication_cycle',
          label: 'B',
          build: async () => null,
        },
      ] as const),
    ).toThrow('Duplicate patient workspace panel provider: pharmacy.current_medication_cycle');
  });
});
