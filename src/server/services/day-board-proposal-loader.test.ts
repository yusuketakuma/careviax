import { describe, expect, it, vi } from 'vitest';

import { loadDayBoardProposals } from './day-board-proposal-loader';

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function createDb() {
  const patientFindMany = vi.fn().mockImplementation(async (args) => {
    if (args.select.insurances) {
      return [{ id: 'patient_1', insurances: [{ insurance_type: 'medical' }] }];
    }
    if (args.select.lab_observations) {
      return [{ id: 'patient_1', lab_observations: [{ analyte_code: 'CRE' }] }];
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
    visitScheduleProposal: {
      findMany: vi.fn().mockResolvedValue([
        {
          id: 'proposal_1',
          display_id: 'vsp0000000001',
          case_id: 'case_1',
          visit_type: 'regular',
          proposal_status: 'proposed',
          patient_contact_status: 'pending',
          proposed_date: new Date('2026-07-21T00:00:00.000Z'),
          time_window_start: null,
          time_window_end: null,
          proposed_pharmacist_id: 'user_1',
        },
      ]),
    },
    careCase: {
      findMany: vi
        .fn()
        .mockResolvedValue([{ id: 'case_1', display_id: 'cc0000000001', patient_id: 'patient_1' }]),
    },
    patient: { findMany: patientFindMany },
  } as unknown as Parameters<typeof loadDayBoardProposals>[0];
}

const args = {
  orgId: 'org_1',
  where: {
    org_id: 'org_1',
    proposal_status: { in: ['proposed' as const] },
  },
  limit: 3,
};

describe('loadDayBoardProposals', () => {
  it('serializes relation prefetch and rebuilds the pending proposal projection', async () => {
    const db = createDb();
    const caseRead =
      createDeferred<Array<{ id: string; display_id: string; patient_id: string }>>();
    vi.mocked(db.careCase.findMany).mockReturnValue(caseRead.promise as never);

    const resultPromise = loadDayBoardProposals(db, args);
    await vi.waitFor(() => expect(db.careCase.findMany).toHaveBeenCalledTimes(1));
    expect(db.patient.findMany).not.toHaveBeenCalled();

    caseRead.resolve([{ id: 'case_1', display_id: 'cc0000000001', patient_id: 'patient_1' }]);
    await expect(resultPromise).resolves.toEqual([
      expect.objectContaining({
        id: 'proposal_1',
        case_: {
          display_id: 'cc0000000001',
          patient: expect.objectContaining({
            id: 'patient_1',
            insurances: [{ insurance_type: 'medical' }],
            lab_observations: [{ analyte_code: 'CRE' }],
          }),
        },
      }),
    ]);
    expect(db.patient.findMany).toHaveBeenCalledTimes(3);
  });

  it('returns early when no pending proposals are visible', async () => {
    const db = createDb();
    vi.mocked(db.visitScheduleProposal.findMany).mockResolvedValue([]);

    await expect(loadDayBoardProposals(db, args)).resolves.toEqual([]);
    expect(db.careCase.findMany).not.toHaveBeenCalled();
    expect(db.patient.findMany).not.toHaveBeenCalled();
  });
});
