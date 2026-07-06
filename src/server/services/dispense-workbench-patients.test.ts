import { describe, expect, it, vi } from 'vitest';
import { listDispenseWorkbenchPatients } from './dispense-workbench-patients';

function createDb() {
  return {
    medicationCycle: {
      findMany: vi.fn().mockResolvedValue([
        {
          id: 'cycle_1',
          patient_id: 'patient_1',
          overall_status: 'dispensing',
          case_: {
            start_date: new Date('2026-06-12T00:00:00.000Z'),
            patient: {
              id: 'patient_1',
              name: '田中一郎',
              name_kana: 'タナカイチロウ',
              created_at: new Date('2026-06-11T15:30:00.000Z'),
            },
          },
          prescription_intakes: [],
        },
      ]),
    },
    setPlan: {
      findMany: vi.fn(),
    },
    setBatch: {
      findMany: vi.fn(),
    },
    dispenseTask: {
      findMany: vi.fn().mockResolvedValue([]),
    },
  };
}

describe('listDispenseWorkbenchPatients', () => {
  it('formats UTC date sentinels and Japan registration dates independently of runtime timezone', async () => {
    const originalTimezone = process.env.TZ;
    process.env.TZ = 'America/New_York';
    try {
      const db = createDb();

      const response = await listDispenseWorkbenchPatients(
        db as never,
        'org_1',
        {
          userId: 'user_1',
          role: 'admin',
        },
        { cursorSecret: 'test-secret', now: new Date('2026-07-06T00:00:00.000Z') },
      );

      expect(response.data).toEqual([
        expect.objectContaining({
          patient_id: 'patient_1',
          start_date: '2026-06-12',
          registered_date: '2026-06-12',
        }),
      ]);
      expect(response.meta).toMatchObject({
        generated_at: '2026-07-06T00:00:00.000Z',
        limit: 50,
        returned_count: 1,
        has_more: false,
        next_cursor: null,
        total_count: 1,
      });
      expect(db.medicationCycle.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ org_id: 'org_1' }),
        }),
      );
    } finally {
      if (originalTimezone === undefined) {
        delete process.env.TZ;
      } else {
        process.env.TZ = originalTimezone;
      }
    }
  });
});
