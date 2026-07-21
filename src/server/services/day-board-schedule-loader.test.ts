import { describe, expect, it, vi } from 'vitest';

import { loadDayBoardSchedules } from './day-board-schedule-loader';

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function scheduleRow(id = 'schedule_1') {
  return {
    id,
    display_id: 'vs0000000001',
    case_id: 'case_1',
    cycle_id: 'cycle_1',
    pharmacist_id: 'user_1',
    visit_type: 'regular',
    schedule_status: 'planned',
    scheduled_date: new Date('2026-07-21T00:00:00.000Z'),
    carry_items_status: 'ready',
    priority: 'normal',
    site_id: 'site_1',
    route_order: 1,
    vehicle_resource_id: 'vehicle_1',
    time_window_start: new Date('1970-01-01T09:00:00.000Z'),
    time_window_end: new Date('1970-01-01T10:00:00.000Z'),
    confirmed_at: null,
    facility_batch_id: 'batch_1',
  };
}

function createDb(overrides: Record<string, unknown> = {}) {
  const patientFindMany = vi.fn().mockImplementation(async (args) => {
    if (args.select.insurances) {
      return [{ id: 'patient_1', insurances: [{ insurance_type: 'medical' }] }];
    }
    if (args.select.lab_observations) {
      return [{ id: 'patient_1', lab_observations: [{ analyte_code: 'CRE' }] }];
    }
    if (args.select.residences) {
      return [
        {
          id: 'patient_1',
          residences: [{ address: '東京都港区', lat: 35.0, lng: 139.0 }],
        },
      ];
    }
    return [
      {
        id: 'patient_1',
        display_id: 'pt0000000001',
        name: '患者 一郎',
        archived_at: null,
        allergy_info: null,
      },
    ];
  });

  return {
    visitSchedule: { findMany: vi.fn().mockResolvedValue([scheduleRow()]) },
    medicationCycle: {
      findMany: vi.fn().mockResolvedValue([{ id: 'cycle_1', overall_status: 'visit_planned' }]),
    },
    visitPreparation: {
      findMany: vi.fn().mockResolvedValue([
        {
          schedule_id: 'schedule_1',
          org_id: 'org_1',
          prepared_at: null,
          medication_changes_reviewed: true,
          carry_items_confirmed: true,
          previous_issues_reviewed: true,
          route_confirmed: true,
          offline_synced: true,
        },
      ]),
    },
    facilityVisitBatch: {
      findMany: vi.fn().mockResolvedValue([{ id: 'batch_1', facility_id: 'facility_1' }]),
    },
    visitRecord: {
      findMany: vi.fn().mockResolvedValue([{ id: 'record_1', schedule_id: 'schedule_1' }]),
    },
    careCase: {
      findMany: vi
        .fn()
        .mockResolvedValue([{ id: 'case_1', display_id: 'cc0000000001', patient_id: 'patient_1' }]),
    },
    careTeamLink: {
      findMany: vi.fn().mockResolvedValue([{ case_id: 'case_1', role: 'physician' }]),
    },
    patient: { findMany: patientFindMany },
    contactParty: {
      findMany: vi.fn().mockResolvedValue([{ id: 'contact_1', patient_id: 'patient_1' }]),
    },
    residence: { findMany: vi.fn() },
    visitVehicleResource: {
      findMany: vi
        .fn()
        .mockResolvedValue([{ id: 'vehicle_1', label: '社用車A', travel_mode: 'DRIVE' }]),
    },
    ...overrides,
  } as unknown as Parameters<typeof loadDayBoardSchedules>[0];
}

const args = {
  orgId: 'org_1',
  dayStart: new Date('2026-07-21T00:00:00.000Z'),
  dayEnd: new Date('2026-07-22T00:00:00.000Z'),
  pageSize: 200,
  maxPages: 50,
};

describe('loadDayBoardSchedules', () => {
  it('prefetches schedule relations sequentially and rebuilds the established projection', async () => {
    const cycleRead = createDeferred<Array<{ id: string; overall_status: string }>>();
    const db = createDb({
      medicationCycle: { findMany: vi.fn().mockReturnValue(cycleRead.promise) },
    });

    const resultPromise = loadDayBoardSchedules(db, args);
    await vi.waitFor(() => expect(db.medicationCycle.findMany).toHaveBeenCalledTimes(1));
    expect(db.visitPreparation.findMany).not.toHaveBeenCalled();

    cycleRead.resolve([{ id: 'cycle_1', overall_status: 'visit_planned' }]);
    const result = await resultPromise;

    expect(result).toEqual([
      expect.objectContaining({
        id: 'schedule_1',
        cycle: { id: 'cycle_1', overall_status: 'visit_planned' },
        facility_batch: { id: 'batch_1', facility_id: 'facility_1' },
        visit_record: { id: 'record_1', schedule_id: 'schedule_1' },
        vehicle_resource: { id: 'vehicle_1', label: '社用車A', travel_mode: 'DRIVE' },
        case_: {
          display_id: 'cc0000000001',
          care_team_links: [{ role: 'physician' }],
          patient: expect.objectContaining({
            id: 'patient_1',
            name: '患者 一郎',
            insurances: [{ insurance_type: 'medical' }],
            lab_observations: [{ analyte_code: 'CRE' }],
            contacts: [{ id: 'contact_1' }],
            residences: [{ address: '東京都港区', lat: 35.0, lng: 139.0 }],
          }),
        },
      }),
    ]);
    expect(db.patient.findMany).toHaveBeenCalledTimes(4);
    expect(db.patient.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: {
          id: true,
          insurances: expect.objectContaining({
            where: expect.objectContaining({ org_id: 'org_1' }),
            take: 6,
            select: expect.objectContaining({
              insurance_type: true,
              application_status: true,
              public_program_code: true,
              copay_ratio: true,
              valid_from: true,
              valid_until: true,
              is_active: true,
            }),
          }),
        },
      }),
    );
    expect(db.patient.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: {
          id: true,
          lab_observations: expect.objectContaining({
            where: expect.objectContaining({ org_id: 'org_1' }),
            take: 6,
            select: expect.objectContaining({
              analyte_code: true,
              value_numeric: true,
              value_text: true,
              unit: true,
              measured_at: true,
              abnormal_flag: true,
            }),
          }),
        },
      }),
    );
  });

  it('returns early without relation queries when the board has no schedules', async () => {
    const db = createDb({
      visitSchedule: { findMany: vi.fn().mockResolvedValue([]) },
    });

    await expect(loadDayBoardSchedules(db, args)).resolves.toEqual([]);
    expect(db.medicationCycle.findMany).not.toHaveBeenCalled();
    expect(db.patient.findMany).not.toHaveBeenCalled();
  });

  it('keeps bounded schedule pagination on a stable id cursor', async () => {
    const findMany = vi
      .fn()
      .mockResolvedValueOnce([scheduleRow('schedule_1')])
      .mockResolvedValueOnce([]);
    const db = createDb({ visitSchedule: { findMany } });

    await loadDayBoardSchedules(db, { ...args, pageSize: 1 });

    expect(findMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ cursor: { id: 'schedule_1' }, skip: 1, take: 1 }),
    );
  });
});
