import { beforeEach, describe, expect, it, vi } from 'vitest';

const { membershipFindManyMock } = vi.hoisted(() => ({ membershipFindManyMock: vi.fn() }));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    patient: { findFirst: vi.fn().mockResolvedValue(null) },
    careCase: { findFirst: vi.fn().mockResolvedValue(null) },
    visitRecord: { findFirst: vi.fn().mockResolvedValue(null) },
    medicationIssue: { findFirst: vi.fn().mockResolvedValue(null) },
    medicationCycle: { findFirst: vi.fn().mockResolvedValue(null) },
    setPlan: { findFirst: vi.fn().mockResolvedValue(null) },
    dispenseTask: { findFirst: vi.fn().mockResolvedValue(null) },
    pharmacySite: { findFirst: vi.fn().mockResolvedValue(null) },
    membership: { findFirst: vi.fn().mockResolvedValue(null), findMany: membershipFindManyMock },
    visitSchedule: { findFirst: vi.fn().mockResolvedValue(null) },
  },
}));

import { validateOrgReferences } from '@/lib/api/org-reference';

describe('validateOrgReferences staff_ids', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('passes when every staff id is an active, eligible org member', async () => {
    membershipFindManyMock.mockResolvedValue([{ user_id: 'u1' }, { user_id: 'u2' }]);
    const result = await validateOrgReferences('org_1', { staff_ids: ['u1', 'u2'] });
    expect(result.ok).toBe(true);
    // org-scoped, active-only, and restricted to assignable roles (no driver / external_viewer)
    const where = membershipFindManyMock.mock.calls[0][0].where;
    expect(where.org_id).toBe('org_1');
    expect(where.is_active).toBe(true);
    expect(where.role.in).toEqual(['owner', 'admin', 'pharmacist', 'pharmacist_trainee', 'clerk']);
    expect(where.user_id.in).toEqual(['u1', 'u2']);
  });

  it('fails when any staff id is not an eligible org member', async () => {
    membershipFindManyMock.mockResolvedValue([{ user_id: 'u1' }]); // u2 missing
    const result = await validateOrgReferences('org_1', { staff_ids: ['u1', 'u2'] });
    expect(result.ok).toBe(false);
  });

  it('deduplicates staff ids before validating', async () => {
    membershipFindManyMock.mockResolvedValue([{ user_id: 'u1' }]);
    const result = await validateOrgReferences('org_1', { staff_ids: ['u1', 'u1'] });
    expect(result.ok).toBe(true);
    expect(membershipFindManyMock.mock.calls[0][0].where.user_id.in).toEqual(['u1']);
  });

  it('does not query memberships when no staff ids are supplied', async () => {
    const result = await validateOrgReferences('org_1', {});
    expect(result.ok).toBe(true);
    expect(membershipFindManyMock).not.toHaveBeenCalled();
  });
});

describe('validateOrgReferences pharmacist_ids', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('passes only when every pharmacist id is an active, eligible org member', async () => {
    membershipFindManyMock.mockResolvedValue([{ user_id: 'p1' }, { user_id: 'p2' }]);
    const result = await validateOrgReferences('org_1', { pharmacist_ids: ['p1', 'p2'] });
    expect(result.ok).toBe(true);
    // pharmacist roles exclude clerk / driver / external_viewer
    const where = membershipFindManyMock.mock.calls[0][0].where;
    expect(where.org_id).toBe('org_1');
    expect(where.is_active).toBe(true);
    expect(where.role.in).toEqual(['owner', 'admin', 'pharmacist', 'pharmacist_trainee']);
    expect(where.user_id.in).toEqual(['p1', 'p2']);
  });

  it('fails when any pharmacist id is not an eligible org member', async () => {
    membershipFindManyMock.mockResolvedValue([{ user_id: 'p2' }]); // primary p1 cross-org / ineligible
    const result = await validateOrgReferences('org_1', { pharmacist_ids: ['p1', 'p2'] });
    expect(result.ok).toBe(false);
  });

  it('deduplicates pharmacist ids before validating', async () => {
    membershipFindManyMock.mockResolvedValue([{ user_id: 'p1' }]);
    const result = await validateOrgReferences('org_1', { pharmacist_ids: ['p1', 'p1'] });
    expect(result.ok).toBe(true);
    expect(membershipFindManyMock.mock.calls[0][0].where.user_id.in).toEqual(['p1']);
  });
});
