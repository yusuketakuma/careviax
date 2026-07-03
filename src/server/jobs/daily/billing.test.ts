import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  organizationFindManyMock,
  billingEvidenceFindManyMock,
  visitRecordFindManyMock,
  upsertBillingEvidenceForVisitMock,
  withOrgContextMock,
  runJobMock,
} = vi.hoisted(() => ({
  organizationFindManyMock: vi.fn(),
  billingEvidenceFindManyMock: vi.fn(),
  visitRecordFindManyMock: vi.fn(),
  upsertBillingEvidenceForVisitMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  runJobMock: vi.fn(async (_jobType: string, fn: () => Promise<unknown>) => fn()),
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    organization: {
      findMany: organizationFindManyMock,
    },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('../runner', () => ({
  runJob: runJobMock,
}));

vi.mock('@/server/services/billing-evidence', () => ({
  upsertBillingEvidenceForVisit: upsertBillingEvidenceForVisitMock,
}));

import { generateBillingEvidenceDaily } from './billing';

// tx は billingEvidence / visitRecord の findMany のみを提供する。
// findMany は「呼び出し時の where.org_id」に対応する fixture を返すことで、
// テナントスコープが実際に効いているか（org_id 無し読み取りをしていないか）を検証する。
function createTx() {
  return {
    billingEvidence: { findMany: billingEvidenceFindManyMock },
    visitRecord: { findMany: visitRecordFindManyMock },
  };
}

describe('generateBillingEvidenceDaily', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runJobMock.mockImplementation(async (_jobType: string, fn: () => Promise<unknown>) => fn());
    // すべての withOrgContext 呼び出しは即座に fn(tx) を実行する。
    withOrgContextMock.mockImplementation(
      async (_orgId: string, fn: (tx: unknown) => Promise<unknown>) => fn(createTx()),
    );
  });

  it('scopes existing-evidence and visit-record reads by org_id (no unscoped global read)', async () => {
    organizationFindManyMock.mockResolvedValue([{ id: 'org_a' }, { id: 'org_b' }]);

    // org ごとの既存 evidence / 未処理 visit を where.org_id で振り分ける。
    billingEvidenceFindManyMock.mockImplementation(
      async ({ where }: { where: { org_id: string } }) => {
        if (where.org_id === 'org_a') return [{ visit_record_id: 'vr_a_done' }];
        return [];
      },
    );
    visitRecordFindManyMock.mockImplementation(async ({ where }: { where: { org_id: string } }) => {
      if (where.org_id === 'org_a') return [{ id: 'vr_a_new' }];
      if (where.org_id === 'org_b') return [{ id: 'vr_b_1' }, { id: 'vr_b_2' }];
      return [];
    });

    const result = await generateBillingEvidenceDaily();

    // 読み取りは必ず org_id 付き。
    for (const call of billingEvidenceFindManyMock.mock.calls) {
      expect(call[0].where).toHaveProperty('org_id');
      expect(call[0].where.org_id).toMatch(/^org_[ab]$/);
    }
    for (const call of visitRecordFindManyMock.mock.calls) {
      expect(call[0].where).toHaveProperty('org_id');
    }

    // org_a は既存 evidence を notIn で除外している。
    const orgAVisitCall = visitRecordFindManyMock.mock.calls.find(
      (call) => call[0].where.org_id === 'org_a',
    );
    expect(orgAVisitCall?.[0].where.id).toEqual({ notIn: ['vr_a_done'] });

    // upsert は各 visit を正しい orgId で処理する（テナント跨ぎ無し）。
    expect(upsertBillingEvidenceForVisitMock).toHaveBeenCalledTimes(3);
    expect(upsertBillingEvidenceForVisitMock).toHaveBeenCalledWith(expect.anything(), {
      orgId: 'org_a',
      visitRecordId: 'vr_a_new',
    });
    expect(upsertBillingEvidenceForVisitMock).toHaveBeenCalledWith(expect.anything(), {
      orgId: 'org_b',
      visitRecordId: 'vr_b_1',
    });
    expect(upsertBillingEvidenceForVisitMock).toHaveBeenCalledWith(expect.anything(), {
      orgId: 'org_b',
      visitRecordId: 'vr_b_2',
    });
    // org_a の visit を org_b context で処理していないこと。
    expect(upsertBillingEvidenceForVisitMock).not.toHaveBeenCalledWith(expect.anything(), {
      orgId: 'org_b',
      visitRecordId: 'vr_a_new',
    });

    expect(result).toEqual({ processedCount: 3 });
  });

  it('omits the notIn filter when an org has no existing evidence', async () => {
    organizationFindManyMock.mockResolvedValue([{ id: 'org_a' }]);
    billingEvidenceFindManyMock.mockResolvedValue([]);
    visitRecordFindManyMock.mockResolvedValue([{ id: 'vr_1' }]);

    await generateBillingEvidenceDaily();

    const call = visitRecordFindManyMock.mock.calls[0];
    expect(call?.[0].where.org_id).toBe('org_a');
    expect(call?.[0].where.id).toBeUndefined();
  });

  it('processes nothing when there are no organizations', async () => {
    organizationFindManyMock.mockResolvedValue([]);

    const result = await generateBillingEvidenceDaily();

    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(upsertBillingEvidenceForVisitMock).not.toHaveBeenCalled();
    expect(result).toEqual({ processedCount: 0 });
  });
});
