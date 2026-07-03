import { beforeEach, describe, expect, it, vi } from 'vitest';

const { dispenseTaskCountMock, withOrgContextMock, buildMedicationCycleAssignmentWhereMock } =
  vi.hoisted(() => ({
    dispenseTaskCountMock: vi.fn(),
    withOrgContextMock: vi.fn(),
    buildMedicationCycleAssignmentWhereMock: vi.fn(),
  }));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    dispenseTask: {
      count: dispenseTaskCountMock,
    },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/server/services/prescription-access', () => ({
  buildMedicationCycleAssignmentWhere: buildMedicationCycleAssignmentWhereMock,
}));

import {
  buildNavBadgePayload,
  countDispenseAuditBadge,
  countHandoffBadge,
  countMyHandoffBadgeItems,
} from './nav-badges';

const pharmacistCtx = {
  orgId: 'org_1',
  userId: 'user_1',
  role: 'pharmacist' as const,
};

describe('nav badge service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    buildMedicationCycleAssignmentWhereMock.mockReturnValue(null);
    dispenseTaskCountMock.mockResolvedValue(4);
    withOrgContextMock.mockImplementation(async (_orgId: string, fn: (tx: unknown) => unknown) =>
      fn({
        handoffItem: {
          count: vi.fn().mockResolvedValue(2),
        },
      }),
    );
  });

  it('counts only current handoff items that involve the viewer or remain unread', () => {
    expect(
      countMyHandoffBadgeItems(
        [
          { created_by: 'user_1', read_by: ['user_2'], lifecycle_status: 'proposed' },
          { created_by: 'user_2', read_by: [], consult_status: 'open' },
          { created_by: 'user_2', read_by: ['user_1'], lifecycle_status: 'proposed' },
          { created_by: 'user_2', read_by: [], lifecycle_status: null, consult_status: null },
        ],
        'user_1',
      ),
    ).toBe(2);
  });

  it('counts unread incoming messages but not my own sent or already-read messages', () => {
    expect(
      countMyHandoffBadgeItems(
        [
          // 自分宛・未読の連絡 → 数える
          { created_by: 'user_2', read_by: [], recipient_user_id: 'user_1' },
          // 自分宛だが既読 → 数えない
          { created_by: 'user_2', read_by: ['user_1'], recipient_user_id: 'user_1' },
          // 自分が送った連絡 → 数えない
          { created_by: 'user_1', read_by: [], recipient_user_id: 'user_2' },
        ],
        'user_1',
      ),
    ).toBe(1);
  });

  it('counts dispense audit badges with the existing assignment scope', async () => {
    const cycleWhere = { assigned_pharmacist_id: 'user_1' };
    buildMedicationCycleAssignmentWhereMock.mockReturnValue(cycleWhere);

    await expect(countDispenseAuditBadge(pharmacistCtx)).resolves.toBe(4);

    expect(dispenseTaskCountMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        status: 'completed',
        cycle: cycleWhere,
        audits: {
          none: {
            result: { notIn: ['hold'] },
          },
        },
      },
    });
  });

  it('gives clerks the handoff badge (連絡ハブ参加) but skips workflow-only badges', async () => {
    // 事務(clerk)は handoff の薬局内連絡に参加するため canReport でバッジを受け取るが、
    // 監査バッジ(canAuditDispense)は持たない。
    const clerkCtx = {
      orgId: 'org_1',
      userId: 'user_1',
      role: 'clerk' as const,
    };

    await expect(buildNavBadgePayload(clerkCtx)).resolves.toEqual({ handoff: 2 });
    expect(dispenseTaskCountMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).toHaveBeenCalledOnce();
  });

  it('aggregates audit and handoff counts with one service call', async () => {
    await expect(buildNavBadgePayload(pharmacistCtx)).resolves.toEqual({
      audit: 4,
      handoff: 2,
    });

    expect(dispenseTaskCountMock).toHaveBeenCalledOnce();
    expect(withOrgContextMock).toHaveBeenCalledOnce();
  });

  it('counts handoff badges in the database instead of loading all items', async () => {
    const count = vi.fn().mockResolvedValue(2);
    withOrgContextMock.mockImplementationOnce(
      async (_orgId: string, fn: (tx: unknown) => unknown) =>
        fn({
          handoffItem: {
            count,
          },
        }),
    );

    await expect(countHandoffBadge(pharmacistCtx)).resolves.toBe(2);

    expect(count).toHaveBeenCalledWith({
      where: {
        board: {
          org_id: 'org_1',
          shift_date: expect.any(Date),
        },
        OR: [
          {
            AND: [
              {
                OR: [{ lifecycle_status: { not: null } }, { consult_status: { not: null } }],
              },
              {
                OR: [{ created_by: 'user_1' }, { NOT: { read_by: { has: 'user_1' } } }],
              },
            ],
          },
          {
            lifecycle_status: null,
            consult_status: null,
            recipient_user_id: 'user_1',
            NOT: { read_by: { has: 'user_1' } },
          },
        ],
      },
    });
  });

  it('returns undefined handoff badge count when the role cannot view handoffs', async () => {
    await expect(
      countHandoffBadge({ orgId: 'org_1', userId: 'driver_1', role: 'driver' }),
    ).resolves.toBeUndefined();
    expect(withOrgContextMock).not.toHaveBeenCalled();
  });

  it('counts the JST business-day board even on a UTC runtime at JST early morning (N30)', async () => {
    const originalTimezone = process.env.TZ;
    process.env.TZ = 'UTC';
    vi.useFakeTimers();
    try {
      // JST 2026-06-12 08:00(UTC では 2026-06-11T23:00Z)。サーバーローカル日付だと前日
      // 2026-06-11 のボードを数えてしまう。JST 業務日 2026-06-12 のボードを数えるべき。
      vi.setSystemTime(new Date('2026-06-11T23:00:00Z'));

      const count = vi.fn().mockResolvedValue(3);
      withOrgContextMock.mockImplementationOnce(
        async (_orgId: string, fn: (tx: unknown) => unknown) =>
          fn({
            handoffItem: {
              count,
            },
          }),
      );

      await countHandoffBadge(pharmacistCtx);

      const shiftDate = count.mock.calls.at(-1)?.[0]?.where?.board?.shift_date as Date;
      expect(shiftDate.toISOString()).toBe('2026-06-12T00:00:00.000Z');
    } finally {
      vi.useRealTimers();
      if (originalTimezone === undefined) {
        delete process.env.TZ;
      } else {
        process.env.TZ = originalTimezone;
      }
    }
  });
});
