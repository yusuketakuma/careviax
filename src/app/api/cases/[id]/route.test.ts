import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const {
  requireAuthContextMock,
  careCaseFindFirstMock,
  validateOrgReferencesMock,
  careCaseUpdateMock,
  withOrgContextMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  careCaseFindFirstMock: vi.fn(),
  validateOrgReferencesMock: vi.fn(),
  careCaseUpdateMock: vi.fn(),
  withOrgContextMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    careCase: {
      findFirst: careCaseFindFirstMock,
    },
  },
}));

vi.mock('@/lib/api/org-reference', () => ({
  validateOrgReferences: validateOrgReferencesMock,
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

import { PATCH } from './route';

describe('/api/cases/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue({
      ctx: {
        orgId: 'org_1',
        userId: 'user_1',
        role: 'pharmacist',
      },
    });
    careCaseFindFirstMock.mockResolvedValue({
      id: 'case_1',
      org_id: 'org_1',
    });
    validateOrgReferencesMock.mockResolvedValue({ ok: true });
    careCaseUpdateMock.mockResolvedValue({
      id: 'case_1',
      primary_pharmacist_id: null,
      backup_pharmacist_id: 'pharmacist_2',
      required_visit_support: { escort: true },
    });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        careCase: {
          update: careCaseUpdateMock,
        },
      }),
    );
  });

  it('updates a case and normalizes empty pharmacist ids to null', async () => {
    const response = (await PATCH({
      json: async () => ({
        primary_pharmacist_id: '',
        backup_pharmacist_id: 'pharmacist_2',
        required_visit_support: { escort: true },
      }),
    } as NextRequest, {
      params: Promise.resolve({ id: 'case_1' }),
    }))!;

    expect(response.status).toBe(200);
    expect(validateOrgReferencesMock).toHaveBeenCalledWith('org_1', {
      pharmacist_id: 'pharmacist_2',
    });
    expect(careCaseUpdateMock).toHaveBeenCalledWith({
      where: { id: 'case_1' },
      data: expect.objectContaining({
        primary_pharmacist_id: null,
        backup_pharmacist_id: 'pharmacist_2',
        required_visit_support: { escort: true },
      }),
    });
  });
});
