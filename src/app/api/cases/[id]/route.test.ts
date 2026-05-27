import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const {
  requireAuthContextMock,
  careCaseFindFirstMock,
  firstVisitDocumentFindFirstMock,
  validateOrgReferencesMock,
  careCaseUpdateMock,
  withOrgContextMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  careCaseFindFirstMock: vi.fn(),
  firstVisitDocumentFindFirstMock: vi.fn(),
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
    firstVisitDocument: {
      findFirst: firstVisitDocumentFindFirstMock,
    },
  },
}));

vi.mock('@/lib/api/org-reference', () => ({
  validateOrgReferences: validateOrgReferencesMock,
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

import { GET, PATCH } from './route';

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
      patient: {
        id: 'patient_1',
        name: '患者 太郎',
        name_kana: 'カンジャ タロウ',
      },
    });
    firstVisitDocumentFindFirstMock.mockResolvedValue(null);
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

  it('scopes GET by case assignment before returning patient details', async () => {
    const response = (await GET({} as NextRequest, {
      params: Promise.resolve({ id: 'case_1' }),
    }))!;

    expect(response.status).toBe(200);
    expect(careCaseFindFirstMock).toHaveBeenCalledWith({
      where: {
        id: 'case_1',
        org_id: 'org_1',
        AND: [
          {
            OR: [
              { primary_pharmacist_id: 'user_1' },
              { backup_pharmacist_id: 'user_1' },
              { visit_schedules: { some: { pharmacist_id: 'user_1' } } },
            ],
          },
        ],
      },
      include: {
        patient: {
          select: {
            id: true,
            name: true,
            name_kana: true,
          },
        },
      },
    });
    expect(firstVisitDocumentFindFirstMock).toHaveBeenCalledWith({
      where: { case_id: 'case_1', org_id: 'org_1' },
      select: {
        id: true,
        delivered_at: true,
        delivered_to: true,
        document_url: true,
        created_at: true,
      },
    });
  });

  it('does not fetch first visit document details for an unassigned case', async () => {
    careCaseFindFirstMock.mockResolvedValue(null);

    const response = (await GET({} as NextRequest, {
      params: Promise.resolve({ id: 'case_2' }),
    }))!;

    expect(response.status).toBe(404);
    expect(firstVisitDocumentFindFirstMock).not.toHaveBeenCalled();
  });

  it('updates a case and normalizes empty pharmacist ids to null', async () => {
    const response = (await PATCH(
      {
        json: async () => ({
          primary_pharmacist_id: '',
          backup_pharmacist_id: 'pharmacist_2',
          required_visit_support: { escort: true },
        }),
      } as NextRequest,
      {
        params: Promise.resolve({ id: 'case_1' }),
      },
    ))!;

    expect(response.status).toBe(200);
    expect(careCaseFindFirstMock).toHaveBeenCalledWith({
      where: {
        id: 'case_1',
        org_id: 'org_1',
        AND: [
          {
            OR: [
              { primary_pharmacist_id: 'user_1' },
              { backup_pharmacist_id: 'user_1' },
              { visit_schedules: { some: { pharmacist_id: 'user_1' } } },
            ],
          },
        ],
      },
    });
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

  it('denies unassigned case PATCH before reference validation or updates', async () => {
    careCaseFindFirstMock.mockResolvedValue(null);

    const response = (await PATCH(
      {
        json: async () => ({
          primary_pharmacist_id: 'user_1',
        }),
      } as NextRequest,
      {
        params: Promise.resolve({ id: 'case_2' }),
      },
    ))!;

    expect(response.status).toBe(404);
    expect(validateOrgReferencesMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(careCaseUpdateMock).not.toHaveBeenCalled();
  });

  it('clears optional dates and text fields when empty strings are provided', async () => {
    const response = (await PATCH(
      {
        json: async () => ({
          referral_source: '',
          start_date: '',
          end_date: '',
          end_reason: '',
          notes: '',
        }),
      } as NextRequest,
      {
        params: Promise.resolve({ id: 'case_1' }),
      },
    ))!;

    expect(response.status).toBe(200);
    expect(careCaseUpdateMock).toHaveBeenCalledWith({
      where: { id: 'case_1' },
      data: expect.objectContaining({
        referral_source: null,
        start_date: null,
        end_date: null,
        end_reason: null,
        notes: null,
      }),
    });
  });
});
