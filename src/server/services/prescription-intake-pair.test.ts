import { describe, expect, it, vi } from 'vitest';
import {
  findCurrentAndPreviousPrescriptionIntakesForMedicationDiff,
  findPreviousPrescriptionIntakeForMedicationDiff,
} from './prescription-intake-pair';

describe('prescription-intake-pair', () => {
  it('finds the previous intake in the same patient case before the current intake timestamp', async () => {
    const findFirst = vi.fn().mockResolvedValue({
      id: 'intake_previous',
      prescribed_date: new Date('2026-06-01T00:00:00.000Z'),
      created_at: new Date('2026-06-01T01:00:00.000Z'),
      lines: [],
    });
    const db = { prescriptionIntake: { findFirst } };
    const currentPrescribedDate = new Date('2026-06-15T00:00:00.000Z');
    const currentCreatedAt = new Date('2026-06-15T01:00:00.000Z');

    const result = await findPreviousPrescriptionIntakeForMedicationDiff(db, {
      orgId: 'org_1',
      patientId: 'patient_1',
      caseId: 'case_1',
      currentIntakeId: 'intake_current',
      currentPrescribedDate,
      currentCreatedAt,
    });

    expect(result?.id).toBe('intake_previous');
    expect(findFirst).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        id: { not: 'intake_current' },
        cycle: {
          patient_id: 'patient_1',
          case_id: 'case_1',
        },
        OR: [
          { prescribed_date: { lt: currentPrescribedDate } },
          {
            prescribed_date: currentPrescribedDate,
            created_at: { lt: currentCreatedAt },
          },
        ],
      },
      orderBy: [{ prescribed_date: 'desc' }, { created_at: 'desc' }],
      select: expect.objectContaining({
        id: true,
        prescribed_date: true,
        created_at: true,
        lines: expect.objectContaining({
          orderBy: { line_number: 'asc' },
        }),
      }),
    });
  });

  it('loads the current intake first and scopes the previous lookup to its case', async () => {
    const current = {
      id: 'intake_current',
      prescribed_date: new Date('2026-06-15T00:00:00.000Z'),
      created_at: new Date('2026-06-15T01:00:00.000Z'),
      cycle: { case_id: 'case_1' },
      lines: [],
    };
    const previous = {
      id: 'intake_previous',
      prescribed_date: new Date('2026-06-01T00:00:00.000Z'),
      created_at: new Date('2026-06-01T01:00:00.000Z'),
      lines: [],
    };
    const findFirst = vi.fn().mockResolvedValueOnce(current).mockResolvedValueOnce(previous);
    const db = { prescriptionIntake: { findFirst } };

    const result = await findCurrentAndPreviousPrescriptionIntakesForMedicationDiff(db, {
      orgId: 'org_1',
      patientId: 'patient_1',
      currentIntakeId: 'intake_current',
    });

    expect(result).toEqual({ current, previous });
    expect(findFirst).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: {
          id: 'intake_current',
          org_id: 'org_1',
          cycle: {
            patient_id: 'patient_1',
          },
        },
      }),
    );
    expect(findFirst).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: expect.objectContaining({
          cycle: {
            patient_id: 'patient_1',
            case_id: 'case_1',
          },
        }),
      }),
    );
  });

  it('does not look for a previous intake when the current intake is outside the patient scope', async () => {
    const findFirst = vi.fn().mockResolvedValueOnce(null);
    const db = { prescriptionIntake: { findFirst } };

    const result = await findCurrentAndPreviousPrescriptionIntakesForMedicationDiff(db, {
      orgId: 'org_1',
      patientId: 'patient_1',
      currentIntakeId: 'intake_other',
    });

    expect(result).toEqual({ current: null, previous: null });
    expect(findFirst).toHaveBeenCalledTimes(1);
  });
});
