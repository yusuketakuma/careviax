import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  prescriptionLineFindManyMock,
  medicationProfileFindManyMock,
  drugInteractionFindFirstMock,
  drugMasterFindFirstMock,
  drugMasterFindManyMock,
  patientFindFirstMock,
  drugAlertRuleFindManyMock,
  drugPackageInsertFindManyMock,
  prescriptionIntakeFindFirstMock,
  patientLabObservationFindFirstMock,
  patientLabObservationFindManyMock,
} = vi.hoisted(() => ({
  prescriptionLineFindManyMock: vi.fn(),
  medicationProfileFindManyMock: vi.fn(),
  drugInteractionFindFirstMock: vi.fn(),
  drugMasterFindFirstMock: vi.fn(),
  drugMasterFindManyMock: vi.fn(),
  patientFindFirstMock: vi.fn(),
  drugAlertRuleFindManyMock: vi.fn(),
  drugPackageInsertFindManyMock: vi.fn(),
  prescriptionIntakeFindFirstMock: vi.fn(),
  patientLabObservationFindFirstMock: vi.fn(),
  patientLabObservationFindManyMock: vi.fn(),
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    prescriptionLine: {
      findMany: prescriptionLineFindManyMock,
    },
    medicationProfile: {
      findMany: medicationProfileFindManyMock,
    },
    drugInteraction: {
      findFirst: drugInteractionFindFirstMock,
    },
    drugMaster: {
      findFirst: drugMasterFindFirstMock,
      findMany: drugMasterFindManyMock,
    },
    patient: {
      findFirst: patientFindFirstMock,
    },
    drugAlertRule: {
      findMany: drugAlertRuleFindManyMock,
    },
    drugPackageInsert: {
      findMany: drugPackageInsertFindManyMock,
    },
    prescriptionIntake: {
      findFirst: prescriptionIntakeFindFirstMock,
    },
    patientLabObservation: {
      findFirst: patientLabObservationFindFirstMock,
      findMany: patientLabObservationFindManyMock,
    },
  },
}));

import { checkDispenseAlerts } from './checker';

describe('checkDispenseAlerts', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    prescriptionLineFindManyMock.mockResolvedValue([]);
    medicationProfileFindManyMock.mockResolvedValue([]);
    drugInteractionFindFirstMock.mockResolvedValue(null);
    drugMasterFindFirstMock.mockResolvedValue(null);
    drugMasterFindManyMock.mockImplementation(async () => []);
    patientFindFirstMock.mockResolvedValue(null);
    drugAlertRuleFindManyMock.mockResolvedValue([]);
    drugPackageInsertFindManyMock.mockResolvedValue([]);
    prescriptionIntakeFindFirstMock.mockResolvedValue(null);
    patientLabObservationFindFirstMock.mockResolvedValue(null);
    patientLabObservationFindManyMock.mockResolvedValue([]);
  });

  it('warns when the current intake is a risky DO prescription continued from the previous intake', async () => {
    prescriptionLineFindManyMock.mockResolvedValue([
      {
        id: 'line_current_1',
        drug_name: 'ロキソプロフェン錠60mg',
        drug_code: '1140001',
        dose: '1錠',
        frequency: '1日3回',
        days: 14,
      },
    ]);

    prescriptionIntakeFindFirstMock
      .mockResolvedValueOnce({
        id: 'intake_current',
        prescribed_date: new Date('2026-03-28T00:00:00.000Z'),
        lines: [
          {
            id: 'line_current_1',
            drug_name: 'ロキソプロフェン錠60mg',
            drug_code: '1140001',
            dose: '1錠',
            frequency: '1日3回',
            days: 14,
          },
        ],
      })
      .mockResolvedValueOnce({
        id: 'intake_previous',
        prescribed_date: new Date('2026-03-14T00:00:00.000Z'),
        lines: [
          {
            id: 'line_prev_1',
            drug_name: 'ロキソプロフェン錠60mg',
            drug_code: '1140001',
            dose: '1錠',
            frequency: '1日3回',
            days: 14,
          },
        ],
      });

    drugMasterFindManyMock.mockResolvedValue([
      {
        id: 'drug_1',
        yj_code: '1140001',
        drug_name: 'ロキソプロフェン錠60mg',
        therapeutic_category: '1140',
        is_narcotic: false,
        is_psychotropic: false,
      },
    ]);

    const alerts = await checkDispenseAlerts('org_1', 'cycle_current', 'patient_1');

    expect(alerts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'do_prescription',
          severity: 'warning',
          message: expect.stringContaining('ロキソプロフェン錠60mg'),
          details: expect.objectContaining({
            current_intake_id: 'intake_current',
            previous_intake_id: 'intake_previous',
          }),
        }),
      ]),
    );
  });

  it('does not warn when the previous intake is not identical', async () => {
    prescriptionLineFindManyMock.mockResolvedValue([
      {
        id: 'line_current_1',
        drug_name: 'ロキソプロフェン錠60mg',
        drug_code: '1140001',
        dose: '1錠',
        frequency: '1日3回',
        days: 14,
      },
    ]);

    prescriptionIntakeFindFirstMock
      .mockResolvedValueOnce({
        id: 'intake_current',
        prescribed_date: new Date('2026-03-28T00:00:00.000Z'),
        lines: [
          {
            id: 'line_current_1',
            drug_name: 'ロキソプロフェン錠60mg',
            drug_code: '1140001',
            dose: '1錠',
            frequency: '1日3回',
            days: 14,
          },
        ],
      })
      .mockResolvedValueOnce({
        id: 'intake_previous',
        prescribed_date: new Date('2026-03-14T00:00:00.000Z'),
        lines: [
          {
            id: 'line_prev_1',
            drug_name: 'ロキソプロフェン錠60mg',
            drug_code: '1140001',
            dose: '1錠',
            frequency: '1日2回',
            days: 14,
          },
        ],
      });

    drugMasterFindManyMock.mockResolvedValue([
      {
        id: 'drug_1',
        yj_code: '1140001',
        drug_name: 'ロキソプロフェン錠60mg',
        therapeutic_category: '1140',
        is_narcotic: false,
        is_psychotropic: false,
      },
    ]);

    const alerts = await checkDispenseAlerts('org_1', 'cycle_current', 'patient_1');

    expect(alerts.find((alert) => alert.type === 'do_prescription')).toBeUndefined();
  });

  it('does not warn when the identical prescription is outside risky continuation categories', async () => {
    prescriptionLineFindManyMock.mockResolvedValue([
      {
        id: 'line_current_1',
        drug_name: 'アムロジピン錠5mg',
        drug_code: '2149001',
        dose: '1錠',
        frequency: '1日1回',
        days: 30,
      },
    ]);

    prescriptionIntakeFindFirstMock
      .mockResolvedValueOnce({
        id: 'intake_current',
        prescribed_date: new Date('2026-03-28T00:00:00.000Z'),
        lines: [
          {
            id: 'line_current_1',
            drug_name: 'アムロジピン錠5mg',
            drug_code: '2149001',
            dose: '1錠',
            frequency: '1日1回',
            days: 30,
          },
        ],
      })
      .mockResolvedValueOnce({
        id: 'intake_previous',
        prescribed_date: new Date('2026-02-28T00:00:00.000Z'),
        lines: [
          {
            id: 'line_prev_1',
            drug_name: 'アムロジピン錠5mg',
            drug_code: '2149001',
            dose: '1錠',
            frequency: '1日1回',
            days: 30,
          },
        ],
      });

    drugMasterFindManyMock.mockResolvedValue([
      {
        id: 'drug_1',
        yj_code: '2149001',
        drug_name: 'アムロジピン錠5mg',
        therapeutic_category: '2149',
        is_narcotic: false,
        is_psychotropic: false,
      },
    ]);

    const alerts = await checkDispenseAlerts('org_1', 'cycle_current', 'patient_1');

    expect(alerts.find((alert) => alert.type === 'do_prescription')).toBeUndefined();
  });
});
