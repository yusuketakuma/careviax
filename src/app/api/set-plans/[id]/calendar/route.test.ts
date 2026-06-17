import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { authMock, prismaMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  prismaMock: {
    membership: { findFirst: vi.fn() },
    setPlan: { findFirst: vi.fn() },
    setBatch: { findMany: vi.fn() },
    prescriptionIntake: { findMany: vi.fn() },
  },
}));

vi.mock('@/lib/auth/config', () => ({
  auth: authMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: prismaMock,
}));

import { GET } from './route';

function createRequest() {
  return new NextRequest('http://localhost/api/set-plans/plan_1/calendar', {
    method: 'GET',
    headers: {
      'x-org-id': 'org_1',
    },
  });
}

describe('/api/set-plans/[id]/calendar GET', () => {
  const originalTimezone = process.env.TZ;

  beforeAll(() => {
    process.env.TZ = 'Asia/Tokyo';
  });

  afterAll(() => {
    if (originalTimezone === undefined) {
      delete process.env.TZ;
    } else {
      process.env.TZ = originalTimezone;
    }
  });

  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    prismaMock.membership.findFirst.mockResolvedValue({ role: 'admin' });
    prismaMock.setPlan.findFirst.mockResolvedValue({
      id: 'plan_1',
      cycle_id: 'cycle_1',
      target_period_start: new Date('2026-04-01T00:00:00.000Z'),
      target_period_end: new Date('2026-04-07T00:00:00.000Z'),
      set_method: 'custom',
      cycle: {
        id: 'cycle_1',
        overall_status: 'setting',
        version: 5,
      },
    });
    prismaMock.prescriptionIntake.findMany.mockResolvedValue([
      {
        lines: [
          {
            id: 'line_1',
            drug_name: 'アムロジピン錠5mg',
            dose: '1錠',
            frequency: '朝',
            unit: '錠',
          },
        ],
      },
    ]);
    prismaMock.setBatch.findMany.mockResolvedValue([
      {
        id: 'batch_d1_morning',
        line_id: 'line_1',
        slot: 'morning',
        day_number: 1,
        quantity: 1,
        carry_type: 'carry',
        set_state: 'set',
        audit_state: 'unaudited',
        ng_code: null,
        held_reason: null,
        version: 1,
      },
      {
        id: 'batch_d2_morning',
        line_id: 'line_1',
        slot: 'morning',
        day_number: 2,
        quantity: 1,
        carry_type: 'carry',
        set_state: 'pending',
        audit_state: 'unaudited',
        ng_code: null,
        held_reason: null,
        version: 1,
      },
    ]);
  });

  it('returns a 7-day × slot matrix with cell states and completion gate', async () => {
    const response = await GET(createRequest(), {
      params: Promise.resolve({ id: 'plan_1' }),
    });
    if (!response) throw new Error('response is required');

    expect(response.status).toBe(200);
    const payload = await response.json();

    expect(payload.data.plan_id).toBe('plan_1');
    expect(payload.data.cycle_id).toBe('cycle_1');
    expect(payload.data.cycle_version).toBe(5);
    expect(payload.data.cycle_status).toBe('setting');
    expect(payload.data.day_count).toBe(7);
    expect(payload.data.slots).toEqual(['morning', 'noon', 'evening', 'bedtime', 'prn']);

    // 1 行(line_1)・7 日分。
    expect(payload.data.rows).toHaveLength(1);
    const row = payload.data.rows[0];
    expect(row.line.id).toBe('line_1');
    expect(row.days).toHaveLength(7);

    // 1 日目 朝 = set、2 日目 朝 = pending、未生成セルは empty。
    expect(row.days[0].cells.morning.state).toBe('set');
    expect(row.days[0].cells.morning.batch_id).toBe('batch_d1_morning');
    expect(row.days[1].cells.morning.state).toBe('pending');
    expect(row.days[0].cells.noon.state).toBe('empty');
    expect(row.days[0].cells.noon.batch_id).toBeNull();

    // completion_gate: 実在セル2(set1 + pending1)・未監査2 → 完了不可。
    expect(payload.data.completion_gate.total_cells).toBe(2);
    expect(payload.data.completion_gate.set_cells).toBe(1);
    expect(payload.data.completion_gate.pending_cells).toBe(1);
    expect(payload.data.completion_gate.set_complete).toBe(false);
    expect(payload.data.completion_gate.audit_complete).toBe(false);
  });

  it('computes set_complete and audit_complete when all cells are set and audited ok', async () => {
    prismaMock.setBatch.findMany.mockResolvedValue([
      {
        id: 'batch_a',
        line_id: 'line_1',
        slot: 'morning',
        day_number: 1,
        quantity: 1,
        carry_type: 'carry',
        set_state: 'set',
        audit_state: 'ok',
        ng_code: null,
        held_reason: null,
        version: 2,
      },
    ]);

    const response = await GET(createRequest(), {
      params: Promise.resolve({ id: 'plan_1' }),
    });
    if (!response) throw new Error('response is required');

    const payload = await response.json();
    expect(payload.data.rows[0].days[0].cells.morning.state).toBe('ok');
    expect(payload.data.completion_gate.set_complete).toBe(true);
    expect(payload.data.completion_gate.audit_complete).toBe(true);
    expect(payload.data.completion_gate.audited_ok_cells).toBe(1);
    expect(payload.data.completion_gate.unaudited_cells).toBe(0);
  });

  it('blocks audit completion when any cell is NG', async () => {
    prismaMock.setBatch.findMany.mockResolvedValue([
      {
        id: 'batch_ok',
        line_id: 'line_1',
        slot: 'morning',
        day_number: 1,
        quantity: 1,
        carry_type: 'carry',
        set_state: 'set',
        audit_state: 'ok',
        ng_code: null,
        held_reason: null,
        version: 2,
      },
      {
        id: 'batch_ng',
        line_id: 'line_1',
        slot: 'evening',
        day_number: 1,
        quantity: 1,
        carry_type: 'carry',
        set_state: 'set',
        audit_state: 'ng',
        ng_code: 'quantity_short',
        held_reason: null,
        version: 3,
      },
    ]);

    const response = await GET(createRequest(), {
      params: Promise.resolve({ id: 'plan_1' }),
    });
    if (!response) throw new Error('response is required');

    const payload = await response.json();
    expect(payload.data.rows[0].days[0].cells.evening.state).toBe('ng');
    expect(payload.data.rows[0].days[0].cells.evening.ng_code).toBe('quantity_short');
    expect(payload.data.completion_gate.set_complete).toBe(true);
    expect(payload.data.completion_gate.audited_ng_cells).toBe(1);
    expect(payload.data.completion_gate.audit_complete).toBe(false);
  });

  it('treats held cells as not pending but still blocking is avoided for set_complete', async () => {
    prismaMock.setBatch.findMany.mockResolvedValue([
      {
        id: 'batch_set',
        line_id: 'line_1',
        slot: 'morning',
        day_number: 1,
        quantity: 1,
        carry_type: 'carry',
        set_state: 'set',
        audit_state: 'unaudited',
        ng_code: null,
        held_reason: null,
        version: 1,
      },
      {
        id: 'batch_hold',
        line_id: 'line_1',
        slot: 'noon',
        day_number: 1,
        quantity: 1,
        carry_type: 'carry',
        set_state: 'hold',
        audit_state: 'unaudited',
        ng_code: null,
        held_reason: 'stock_shortage',
        version: 1,
      },
    ]);

    const response = await GET(createRequest(), {
      params: Promise.resolve({ id: 'plan_1' }),
    });
    if (!response) throw new Error('response is required');

    const payload = await response.json();
    expect(payload.data.rows[0].days[0].cells.noon.state).toBe('hold');
    expect(payload.data.rows[0].days[0].cells.noon.held_reason).toBe('stock_shortage');
    expect(payload.data.completion_gate.hold_cells).toBe(1);
    expect(payload.data.completion_gate.pending_cells).toBe(0);
    // 保留を除く全セルがセット済 → set_complete true。
    expect(payload.data.completion_gate.set_complete).toBe(true);
  });

  it('returns 404 for an unassigned pharmacist before reading batches or intakes', async () => {
    prismaMock.membership.findFirst.mockResolvedValue({ role: 'pharmacist' });
    prismaMock.setPlan.findFirst.mockResolvedValue(null);

    const response = await GET(createRequest(), {
      params: Promise.resolve({ id: 'plan_1' }),
    });
    if (!response) throw new Error('response is required');

    expect(response.status).toBe(404);
    expect(prismaMock.setPlan.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'plan_1',
        org_id: 'org_1',
      },
      select: expect.any(Object),
    });
    expect(prismaMock.setBatch.findMany).not.toHaveBeenCalled();
    expect(prismaMock.prescriptionIntake.findMany).not.toHaveBeenCalled();
  });

  it('denies clerks via the canSet permission gate', async () => {
    prismaMock.membership.findFirst.mockResolvedValue({ role: 'clerk' });

    const response = await GET(createRequest(), {
      params: Promise.resolve({ id: 'plan_1' }),
    });
    if (!response) throw new Error('response is required');

    expect(response.status).toBe(403);
    expect(prismaMock.setPlan.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.setBatch.findMany).not.toHaveBeenCalled();
  });
});
