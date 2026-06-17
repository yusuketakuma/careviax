import { describe, it, expect, vi, beforeEach } from 'vitest';

// Hoisted mocks
const mockFindFirst = vi.hoisted(() => vi.fn());
const mockUpdateMany = vi.hoisted(() => vi.fn());
const mockCreate = vi.hoisted(() => vi.fn());

// Build a mock TransactionClient
function makeMockTx() {
  return {
    medicationCycle: {
      findFirst: mockFindFirst,
      updateMany: mockUpdateMany,
    },
    cycleTransitionLog: {
      findFirst: mockFindFirst,
      create: mockCreate,
    },
  } as unknown as import('@prisma/client').Prisma.TransactionClient;
}

import {
  transitionCycleStatus,
  getPreHoldStatus,
  ALLOWED_TRANSITIONS,
  InvalidTransitionError,
  VersionConflictError,
} from '../cycle-transition';

const ORG_ID = 'clh4dz2xq0000qzrm8n9j3k1p';
const CYCLE_ID = 'clh4dz2xq1111qzrm8n9j3k1p';
const USER_ID = 'clh4dz2xq2222qzrm8n9j3k1p';

describe('ALLOWED_TRANSITIONS', () => {
  it('exports the full transition map', () => {
    expect(ALLOWED_TRANSITIONS).toBeDefined();
    expect(ALLOWED_TRANSITIONS.intake_received).toContain('structuring');
    expect(ALLOWED_TRANSITIONS.cancelled).toHaveLength(0);
  });
});

describe('transitionCycleStatus', () => {
  let tx: ReturnType<typeof makeMockTx>;

  beforeEach(() => {
    vi.clearAllMocks();
    tx = makeMockTx();
  });

  it('valid transition succeeds and returns updated cycle', async () => {
    const fakeCycle = { id: CYCLE_ID, overall_status: 'intake_received', version: 1 };

    mockFindFirst.mockResolvedValueOnce(fakeCycle);
    mockUpdateMany.mockResolvedValueOnce({ count: 1 });
    mockCreate.mockResolvedValueOnce({});

    const result = await transitionCycleStatus(tx, CYCLE_ID, ORG_ID, 'structuring', USER_ID);

    expect(result).toEqual({ id: CYCLE_ID, overall_status: 'structuring', version: 2 });
    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: { id: CYCLE_ID, org_id: ORG_ID, version: 1 },
      data: expect.objectContaining({
        overall_status: 'structuring',
        version: { increment: 1 },
      }),
    });
  });

  it('invalid transition throws InvalidTransitionError', async () => {
    const fakeCycle = { id: CYCLE_ID, overall_status: 'cancelled', version: 1 };
    mockFindFirst.mockResolvedValueOnce(fakeCycle);

    await expect(
      transitionCycleStatus(tx, CYCLE_ID, ORG_ID, 'structuring', USER_ID),
    ).rejects.toThrow(InvalidTransitionError);
  });

  it('invalid transition error contains correct from/to status', async () => {
    const fakeCycle = { id: CYCLE_ID, overall_status: 'reported', version: 1 };
    mockFindFirst.mockResolvedValueOnce(fakeCycle);

    await expect(
      transitionCycleStatus(tx, CYCLE_ID, ORG_ID, 'dispensing', USER_ID),
    ).rejects.toMatchObject({
      fromStatus: 'reported',
      toStatus: 'dispensing',
    });
  });

  it('version mismatch throws VersionConflictError', async () => {
    const fakeCycle = { id: CYCLE_ID, overall_status: 'intake_received', version: 1 };
    mockFindFirst.mockResolvedValueOnce(fakeCycle);
    mockUpdateMany.mockResolvedValueOnce({ count: 0 });

    await expect(
      transitionCycleStatus(tx, CYCLE_ID, ORG_ID, 'structuring', USER_ID),
    ).rejects.toThrow(VersionConflictError);
  });

  it('CycleTransitionLog is created with correct from/to/actor', async () => {
    const fakeCycle = { id: CYCLE_ID, overall_status: 'ready_to_dispense', version: 3 };
    mockFindFirst.mockResolvedValueOnce(fakeCycle);
    mockUpdateMany.mockResolvedValueOnce({ count: 1 });
    mockCreate.mockResolvedValueOnce({});

    await transitionCycleStatus(tx, CYCLE_ID, ORG_ID, 'dispensing', USER_ID);

    expect(mockCreate).toHaveBeenCalledWith({
      data: {
        org_id: ORG_ID,
        cycle_id: CYCLE_ID,
        from_status: 'ready_to_dispense',
        to_status: 'dispensing',
        actor_id: USER_ID,
        note: undefined,
      },
    });
  });

  it('exceptionStatus option is applied in update data', async () => {
    const fakeCycle = { id: CYCLE_ID, overall_status: 'visit_ready', version: 2 };
    mockFindFirst.mockResolvedValueOnce(fakeCycle);
    mockUpdateMany.mockResolvedValueOnce({ count: 1 });
    mockCreate.mockResolvedValueOnce({});

    await transitionCycleStatus(tx, CYCLE_ID, ORG_ID, 'on_hold', USER_ID, {
      exceptionStatus: 'no_show',
    });

    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: { id: CYCLE_ID, org_id: ORG_ID, version: 2 },
      data: expect.objectContaining({
        exception_status: 'no_show',
      }),
    });
  });

  it('exceptionStatus null is applied (clears the field)', async () => {
    const fakeCycle = { id: CYCLE_ID, overall_status: 'visit_ready', version: 1 };
    mockFindFirst.mockResolvedValueOnce(fakeCycle);
    mockUpdateMany.mockResolvedValueOnce({ count: 1 });
    mockCreate.mockResolvedValueOnce({});

    await transitionCycleStatus(tx, CYCLE_ID, ORG_ID, 'on_hold', USER_ID, {
      exceptionStatus: null,
    });

    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: { id: CYCLE_ID, org_id: ORG_ID, version: 1 },
      data: expect.objectContaining({
        exception_status: null,
      }),
    });
  });

  it('note option is recorded in the transition log', async () => {
    const fakeCycle = { id: CYCLE_ID, overall_status: 'audit_pending', version: 5 };
    mockFindFirst.mockResolvedValueOnce(fakeCycle);
    mockUpdateMany.mockResolvedValueOnce({ count: 1 });
    mockCreate.mockResolvedValueOnce({});

    await transitionCycleStatus(tx, CYCLE_ID, ORG_ID, 'audited', USER_ID, {
      note: '監査完了',
    });

    expect(mockCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        note: '監査完了',
      }),
    });
  });

  it('throws not-found error when cycle does not exist', async () => {
    mockFindFirst.mockResolvedValueOnce(null);

    await expect(
      transitionCycleStatus(tx, CYCLE_ID, ORG_ID, 'structuring', USER_ID),
    ).rejects.toThrow(`MedicationCycle not found: ${CYCLE_ID}`);
  });
});

describe('getPreHoldStatus', () => {
  let tx: ReturnType<typeof makeMockTx>;

  beforeEach(() => {
    vi.clearAllMocks();
    tx = makeMockTx();
  });

  it('returns the from_status of the most recent on_hold transition', async () => {
    mockFindFirst.mockResolvedValueOnce({ from_status: 'visit_ready' });

    const result = await getPreHoldStatus(tx, CYCLE_ID);

    expect(result).toBe('visit_ready');
    expect(mockFindFirst).toHaveBeenCalledWith({
      where: { cycle_id: CYCLE_ID, to_status: 'on_hold' },
      orderBy: { created_at: 'desc' },
      select: { from_status: true },
    });
  });

  it('returns null when no on_hold log exists', async () => {
    mockFindFirst.mockResolvedValueOnce(null);

    const result = await getPreHoldStatus(tx, CYCLE_ID);

    expect(result).toBeNull();
  });
});
