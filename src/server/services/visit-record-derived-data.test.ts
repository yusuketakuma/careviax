import { beforeEach, describe, expect, it, vi } from 'vitest';

const { allocateDisplayIdRangeMock } = vi.hoisted(() => ({
  allocateDisplayIdRangeMock: vi.fn(),
}));

vi.mock('@/lib/db/display-id', () => ({
  allocateDisplayIdRange: allocateDisplayIdRangeMock,
}));

import {
  replaceVisitRecordResidualMedications,
  syncVisitRecordLabObservations,
} from './visit-record-derived-data';

describe('visit-record-derived-data display_id allocation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('allocates PatientLabObservation display ids for exactly the lab rows inserted', async () => {
    const patientLabObservationDeleteMany = vi.fn().mockResolvedValue({ count: 0 });
    const patientLabObservationCreateMany = vi.fn().mockResolvedValue({ count: 2 });
    const tx = {
      patientLabObservation: {
        deleteMany: patientLabObservationDeleteMany,
        createMany: patientLabObservationCreateMany,
      },
    };
    allocateDisplayIdRangeMock.mockResolvedValue(['plab0000000001', 'plab0000000002']);

    await syncVisitRecordLabObservations(
      tx as never,
      'org_1',
      'patient_1',
      'visit_1',
      new Date('2026-06-01T00:00:00.000Z'),
      {
        objective: {
          lab_values: {
            egfr: 42,
            scr: 1.2,
            unknown: 999,
            k: '5.1',
          },
        },
      },
    );

    expect(patientLabObservationDeleteMany).toHaveBeenCalledWith({
      where: { org_id: 'org_1', source_visit_record_id: 'visit_1' },
    });
    expect(allocateDisplayIdRangeMock).toHaveBeenCalledWith(
      tx,
      'PatientLabObservation',
      'org_1',
      2,
    );
    expect(patientLabObservationCreateMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          display_id: 'plab0000000001',
          analyte_code: 'egfr',
          value_numeric: 42,
        }),
        expect.objectContaining({
          display_id: 'plab0000000002',
          analyte_code: 'scr',
          value_numeric: 1.2,
        }),
      ],
    });
  });

  it('does not allocate PatientLabObservation display ids when no lab rows are inserted', async () => {
    const patientLabObservationDeleteMany = vi.fn().mockResolvedValue({ count: 0 });
    const patientLabObservationCreateMany = vi.fn();
    const tx = {
      patientLabObservation: {
        deleteMany: patientLabObservationDeleteMany,
        createMany: patientLabObservationCreateMany,
      },
    };

    await syncVisitRecordLabObservations(
      tx as never,
      'org_1',
      'patient_1',
      'visit_1',
      new Date('2026-06-01T00:00:00.000Z'),
      { objective: { lab_values: { egfr: '42' } } },
    );

    expect(patientLabObservationDeleteMany).toHaveBeenCalledOnce();
    expect(allocateDisplayIdRangeMock).not.toHaveBeenCalled();
    expect(patientLabObservationCreateMany).not.toHaveBeenCalled();
  });

  it('allocates ResidualMedication display ids in a stable batch before row creates', async () => {
    const residualMedicationDeleteMany = vi.fn().mockResolvedValue({ count: 0 });
    const residualMedicationCreate = vi.fn().mockResolvedValue({ id: 'residual_1' });
    const tx = {
      residualMedication: {
        deleteMany: residualMedicationDeleteMany,
        create: residualMedicationCreate,
      },
    };
    allocateDisplayIdRangeMock.mockResolvedValue(['rmed0000000001', 'rmed0000000002']);

    await replaceVisitRecordResidualMedications(tx as never, 'org_1', 'visit_1', [
      {
        drug_name: 'アムロジピン',
        prescribed_daily_dose: 1,
        remaining_quantity: 10,
        is_prohibited_reduction: false,
      },
      {
        drug_name: 'オキシコドン',
        prescribed_daily_dose: 2,
        remaining_quantity: 6,
        is_prohibited_reduction: true,
      },
    ]);

    expect(residualMedicationDeleteMany).toHaveBeenCalledWith({
      where: { org_id: 'org_1', visit_record_id: 'visit_1' },
    });
    expect(allocateDisplayIdRangeMock).toHaveBeenCalledWith(tx, 'ResidualMedication', 'org_1', 2);
    expect(residualMedicationCreate).toHaveBeenNthCalledWith(1, {
      data: expect.objectContaining({
        display_id: 'rmed0000000001',
        drug_name: 'アムロジピン',
        excess_days: 10,
        is_reduction_target: true,
      }),
    });
    expect(residualMedicationCreate).toHaveBeenNthCalledWith(2, {
      data: expect.objectContaining({
        display_id: 'rmed0000000002',
        drug_name: 'オキシコドン',
        excess_days: 3,
        is_reduction_target: false,
        is_prohibited_reduction: true,
      }),
    });
  });

  it('does not allocate ResidualMedication display ids when no rows are inserted', async () => {
    const residualMedicationDeleteMany = vi.fn().mockResolvedValue({ count: 0 });
    const residualMedicationCreate = vi.fn();
    const tx = {
      residualMedication: {
        deleteMany: residualMedicationDeleteMany,
        create: residualMedicationCreate,
      },
    };

    await replaceVisitRecordResidualMedications(tx as never, 'org_1', 'visit_1', []);

    expect(residualMedicationDeleteMany).toHaveBeenCalledOnce();
    expect(allocateDisplayIdRangeMock).not.toHaveBeenCalled();
    expect(residualMedicationCreate).not.toHaveBeenCalled();
  });
});
