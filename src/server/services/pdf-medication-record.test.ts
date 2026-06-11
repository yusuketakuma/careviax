import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getMedicationHistoryRecord } from '@/server/services/pdf-medication-record';
import { PdfNotFoundError } from './pdf-errors';

const { patientFindFirstMock, medicationProfileFindManyMock } = vi.hoisted(() => ({
  patientFindFirstMock: vi.fn(),
  medicationProfileFindManyMock: vi.fn(),
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    patient: {
      findFirst: patientFindFirstMock,
    },
    medicationProfile: {
      findMany: medicationProfileFindManyMock,
    },
  },
}));

describe('getMedicationHistoryRecord', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not query medication profiles until the patient access check succeeds', async () => {
    patientFindFirstMock.mockResolvedValue(null);

    await expect(getMedicationHistoryRecord('org_1', 'patient_1')).rejects.toBeInstanceOf(
      PdfNotFoundError,
    );

    expect(patientFindFirstMock).toHaveBeenCalledWith({
      where: { id: 'patient_1', org_id: 'org_1' },
      select: {
        id: true,
        name: true,
        birth_date: true,
        gender: true,
      },
    });
    expect(medicationProfileFindManyMock).not.toHaveBeenCalled();
  });

  it('returns current medications after scoped patient lookup succeeds', async () => {
    const patient = {
      id: 'patient_1',
      name: '山田 太郎',
      birth_date: new Date(1940, 0, 1),
      gender: 'male',
    };
    const medications = [
      {
        id: 'med_1',
        drug_name: '朝昼夕薬',
        dose: '1錠',
        frequency: '毎食後',
        start_date: new Date(2026, 3, 1),
        end_date: null,
        prescriber: '主治医',
        source: 'manual',
      },
    ];
    patientFindFirstMock.mockResolvedValue(patient);
    medicationProfileFindManyMock.mockResolvedValue(medications);

    await expect(
      getMedicationHistoryRecord('org_1', 'patient_1', {
        userId: 'pharmacist_1',
        role: 'pharmacist',
      }),
    ).resolves.toEqual({
      patient,
      medications,
    });

    expect(patientFindFirstMock).toHaveBeenCalledWith({
      where: {
        id: 'patient_1',
        org_id: 'org_1',
        AND: [
          {
            cases: {
              some: {
                OR: [
                  { primary_pharmacist_id: 'pharmacist_1' },
                  { backup_pharmacist_id: 'pharmacist_1' },
                  { visit_schedules: { some: { pharmacist_id: 'pharmacist_1' } } },
                ],
              },
            },
          },
        ],
      },
      select: {
        id: true,
        name: true,
        birth_date: true,
        gender: true,
      },
    });
    expect(medicationProfileFindManyMock).toHaveBeenCalledWith({
      where: { org_id: 'org_1', patient_id: 'patient_1', is_current: true },
      orderBy: [{ drug_name: 'asc' }, { created_at: 'desc' }],
      select: {
        id: true,
        drug_name: true,
        dose: true,
        frequency: true,
        start_date: true,
        end_date: true,
        prescriber: true,
        source: true,
      },
    });
  });
});
