import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const {
  requireAuthContextMock,
  careReportFindFirstMock,
  careReportUpdateMock,
  withOrgContextMock,
  findLatestPrescriberInstitutionSuggestionMock,
  getChannelStatsByNameMock,
  getRecommendedChannelsMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  careReportFindFirstMock: vi.fn(),
  careReportUpdateMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  findLatestPrescriberInstitutionSuggestionMock: vi.fn(),
  getChannelStatsByNameMock: vi.fn(),
  getRecommendedChannelsMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    careReport: {
      findFirst: careReportFindFirstMock,
    },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/lib/prescriptions/prescriber-institutions', () => ({
  findLatestPrescriberInstitutionSuggestion: findLatestPrescriberInstitutionSuggestionMock,
}));

vi.mock('@/lib/contact-profiles', () => ({
  getChannelStatsByName: getChannelStatsByNameMock,
  getRecommendedChannels: getRecommendedChannelsMock,
}));

import { GET, PATCH } from './route';

function createRequest(body?: unknown) {
  return {
    headers: {
      get: (key: string) => ({ 'x-org-id': 'org_1' }[key] ?? null),
    },
    json: body === undefined ? undefined : vi.fn().mockResolvedValue(body),
  } as unknown as NextRequest;
}

describe('care-reports/[id] route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue({
      ctx: {
        userId: 'user_1',
        orgId: 'org_1',
        role: 'admin',
      },
    });
    careReportFindFirstMock.mockResolvedValue({
      id: 'report_1',
      org_id: 'org_1',
      patient_id: 'patient_1',
      case_id: 'case_1',
      report_type: 'physician_report',
      status: 'draft',
      content: {},
      template_id: null,
      pdf_url: null,
      created_by: 'user_1',
      created_at: new Date('2026-03-30T00:00:00.000Z'),
      updated_at: new Date('2026-03-30T00:10:00.000Z'),
      delivery_records: [],
      case_: {
        required_visit_support: null,
      },
    });
    careReportUpdateMock.mockResolvedValue({
      id: 'report_1',
      status: 'draft',
    });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        careReport: {
          update: careReportUpdateMock,
        },
      })
    );
    findLatestPrescriberInstitutionSuggestionMock.mockResolvedValue({
      id: 'institution_1',
      name: 'みなとクリニック',
      phone: '03-1111-2222',
      fax: '03-1111-3333',
      address: '東京都港区1-1-1',
      prescribed_date: new Date('2026-03-28T00:00:00.000Z'),
      prescriber_name: '田中 一郎',
    });
    getChannelStatsByNameMock.mockResolvedValue(
      new Map([
        [
          'みなとクリニック',
          {
            fax: { success: 2, failure: 0 },
            phone: { success: 1, failure: 1 },
            email: { success: 0, failure: 0 },
            ses: { success: 0, failure: 0 },
            postal: { success: 0, failure: 0 },
            in_person: { success: 0, failure: 0 },
          },
        ],
      ])
    );
    getRecommendedChannelsMock.mockReturnValue(['fax', 'phone', 'postal']);
  });

  it('returns report detail with prescriber institution delivery recommendations', async () => {
    const response = await GET(createRequest(), {
      params: Promise.resolve({ id: 'report_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(findLatestPrescriberInstitutionSuggestionMock).toHaveBeenCalledWith(
      expect.anything(),
      'org_1',
      {
        caseId: 'case_1',
        patientId: 'patient_1',
      }
    );
    expect(getChannelStatsByNameMock).toHaveBeenCalledWith(expect.anything(), 'org_1', [
      'みなとクリニック',
    ]);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        id: 'report_1',
        prescriber_institution_suggestion: {
          id: 'institution_1',
          recommended_channels: ['fax', 'phone', 'postal'],
          prescribed_date: '2026-03-28T00:00:00.000Z',
        },
      },
    });
  });

  it('rejects non-draft status updates outside the send workflow', async () => {
    const response = await PATCH(createRequest({ status: 'sent' }), {
      params: Promise.resolve({ id: 'report_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(409);
  });

  it('rejects reverting a sent report back to draft', async () => {
    careReportFindFirstMock.mockResolvedValue({
      id: 'report_1',
      status: 'sent',
    });

    const response = await PATCH(createRequest({ status: 'draft' }), {
      params: Promise.resolve({ id: 'report_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(409);
  });
});
