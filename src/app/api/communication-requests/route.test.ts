import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const {
  communicationRequestFindManyMock,
  communicationRequestCreateMock,
  tracingReportFindFirstMock,
  patientFindManyMock,
  careCaseFindManyMock,
  careCaseFindFirstMock,
  findLatestPrescriberInstitutionSuggestionMock,
  pickCommunicationRecipientCandidateMock,
  withOrgContextMock,
} = vi.hoisted(() => ({
  communicationRequestFindManyMock: vi.fn(),
  communicationRequestCreateMock: vi.fn(),
  tracingReportFindFirstMock: vi.fn(),
  patientFindManyMock: vi.fn(),
  careCaseFindManyMock: vi.fn(),
  careCaseFindFirstMock: vi.fn(),
  findLatestPrescriberInstitutionSuggestionMock: vi.fn(),
  pickCommunicationRecipientCandidateMock: vi.fn(),
  withOrgContextMock: vi.fn(),
}));

vi.mock('@/lib/auth/middleware', () => ({
  withAuth: (
    handler: (
      req: NextRequest & { orgId: string; userId: string; role: 'pharmacist' },
    ) => Promise<Response>,
  ) => {
    return (req: NextRequest) =>
      handler({
        ...req,
        orgId: 'org_1',
        userId: 'user_1',
        role: 'pharmacist',
      } as unknown as NextRequest & { orgId: string; userId: string; role: 'pharmacist' });
  },
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    communicationRequest: {
      findMany: communicationRequestFindManyMock,
    },
    tracingReport: {
      findFirst: tracingReportFindFirstMock,
    },
    patient: {
      findMany: patientFindManyMock,
    },
    careCase: {
      findMany: careCaseFindManyMock,
      findFirst: careCaseFindFirstMock,
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
  pickCommunicationRecipientCandidate: pickCommunicationRecipientCandidateMock,
}));

import { GET, POST } from './route';

describe('/api/communication-requests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    communicationRequestFindManyMock.mockResolvedValue([{ id: 'request_1', status: 'draft' }]);
    communicationRequestCreateMock.mockResolvedValue({ id: 'request_2', status: 'draft' });
    tracingReportFindFirstMock.mockResolvedValue({
      id: 'tracing_1',
      patient_id: 'patient_1',
      case_id: 'case_1',
    });
    patientFindManyMock.mockResolvedValue([{ id: 'patient_1' }]);
    careCaseFindManyMock.mockResolvedValue([{ id: 'case_1' }]);
    careCaseFindFirstMock.mockResolvedValue({ id: 'case_1' });
    findLatestPrescriberInstitutionSuggestionMock.mockResolvedValue(null);
    pickCommunicationRecipientCandidateMock.mockResolvedValue(null);
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        communicationRequest: {
          create: communicationRequestCreateMock,
        },
      }),
    );
  });

  it('lists communication requests', async () => {
    const response = (await GET({
      url: 'http://localhost/api/communication-requests?status=draft',
    } as NextRequest))!;

    expect(response.status).toBe(200);
    expect(communicationRequestFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          AND: [
            expect.objectContaining({
              OR: expect.arrayContaining([
                { case_id: { in: ['case_1'] } },
                { AND: [{ case_id: null }, { patient_id: { in: ['patient_1'] } }] },
              ]),
            }),
          ],
        }),
      }),
    );
  });

  it('returns 400 for an invalid status filter', async () => {
    const response = (await GET({
      url: 'http://localhost/api/communication-requests?status=foo',
    } as NextRequest))!;

    expect(response.status).toBe(400);
    expect(communicationRequestFindManyMock).not.toHaveBeenCalled();
  });

  it('creates a communication request', async () => {
    const response = (await POST({
      json: async () => ({
        request_type: '疑義照会',
        subject: '確認事項',
        content: '処方内容を確認したいです',
      }),
    } as NextRequest))!;

    expect(response.status).toBe(201);
    expect(communicationRequestCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        org_id: 'org_1',
        request_type: '疑義照会',
        requested_by: 'user_1',
        context_snapshot: {},
      }),
    });
  });

  it('rejects an unassigned case before recipient suggestion or create side effects', async () => {
    careCaseFindFirstMock.mockResolvedValue(null);

    const response = (await POST({
      json: async () => ({
        patient_id: 'patient_2',
        case_id: 'case_2',
        request_type: '疑義照会',
        subject: '確認事項',
        content: '処方内容を確認したいです',
      }),
    } as NextRequest))!;

    expect(response.status).toBe(400);
    expect(findLatestPrescriberInstitutionSuggestionMock).not.toHaveBeenCalled();
    expect(pickCommunicationRecipientCandidateMock).not.toHaveBeenCalled();
    expect(communicationRequestCreateMock).not.toHaveBeenCalled();
  });

  it('derives patient and case from an accessible linked tracing report', async () => {
    const response = (await POST({
      json: async () => ({
        request_type: 'tracing_report',
        related_entity_type: 'tracing_report',
        related_entity_id: 'tracing_1',
        subject: '服薬情報提供書',
        content: '処方医へ共有します',
      }),
    } as NextRequest))!;

    expect(response.status).toBe(201);
    expect(tracingReportFindFirstMock).toHaveBeenCalledWith({
      where: {
        id: 'tracing_1',
        org_id: 'org_1',
      },
      select: {
        id: true,
        patient_id: true,
        case_id: true,
      },
    });
    expect(communicationRequestCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        patient_id: 'patient_1',
        case_id: 'case_1',
        related_entity_type: 'tracing_report',
        related_entity_id: 'tracing_1',
      }),
    });
  });

  it('rejects a cross-case tracing report link before create side effects', async () => {
    tracingReportFindFirstMock.mockResolvedValue({
      id: 'tracing_2',
      patient_id: 'patient_1',
      case_id: 'case_2',
    });

    const response = (await POST({
      json: async () => ({
        patient_id: 'patient_1',
        case_id: 'case_1',
        request_type: 'tracing_report',
        related_entity_type: 'tracing_report',
        related_entity_id: 'tracing_2',
        subject: '服薬情報提供書',
        content: '処方医へ共有します',
      }),
    } as NextRequest))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '関連トレーシングレポートと患者またはケースが一致しません',
    });
    expect(findLatestPrescriberInstitutionSuggestionMock).not.toHaveBeenCalled();
    expect(pickCommunicationRecipientCandidateMock).not.toHaveBeenCalled();
    expect(communicationRequestCreateMock).not.toHaveBeenCalled();
  });

  it('returns not found for an inaccessible linked tracing report before side effects', async () => {
    careCaseFindFirstMock.mockResolvedValue(null);

    const response = (await POST({
      json: async () => ({
        request_type: 'tracing_report',
        related_entity_type: 'tracing_report',
        related_entity_id: 'tracing_1',
        subject: '服薬情報提供書',
        content: '処方医へ共有します',
      }),
    } as NextRequest))!;

    expect(response.status).toBe(404);
    expect(findLatestPrescriberInstitutionSuggestionMock).not.toHaveBeenCalled();
    expect(pickCommunicationRecipientCandidateMock).not.toHaveBeenCalled();
    expect(communicationRequestCreateMock).not.toHaveBeenCalled();
  });

  it('fills the recipient from the latest prescriber institution when missing', async () => {
    findLatestPrescriberInstitutionSuggestionMock.mockResolvedValue({
      id: 'institution_1',
      name: 'みなとクリニック',
      phone: '03-1111-2222',
      fax: '03-1111-3333',
      address: '東京都港区1-1-1',
      prescribed_date: new Date('2026-03-28T00:00:00.000Z'),
      prescriber_name: '田中 一郎',
    });

    const response = (await POST({
      json: async () => ({
        patient_id: 'patient_1',
        case_id: 'case_1',
        request_type: '疑義照会',
        subject: '処方確認',
        content: '用量の確認をお願いします',
      }),
    } as NextRequest))!;

    expect(response.status).toBe(201);
    expect(findLatestPrescriberInstitutionSuggestionMock).toHaveBeenCalledWith(
      expect.anything(),
      'org_1',
      {
        caseId: 'case_1',
        patientId: 'patient_1',
      },
    );
    expect(communicationRequestCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        recipient_name: '田中 一郎',
        recipient_role: '処方元医療機関',
        context_snapshot: {
          prescriber_institution_id: 'institution_1',
          prescriber_institution_name: 'みなとクリニック',
        },
      }),
    });
  });

  it('falls back to an external professional when no institution suggestion exists', async () => {
    pickCommunicationRecipientCandidateMock.mockResolvedValue({
      id: 'external_1',
      name: '山田 ケアマネ',
      profession_type: 'care_manager',
      organization_name: '居宅支援A',
      department: null,
      phone: '03-4444-5555',
      email: null,
      fax: '03-4444-6666',
      preferred_contact_method: 'fax',
      preferred_contact_time: '平日 14:00-17:00',
      last_contacted_at: null,
      last_success_channel: 'fax',
      recommended_channels: ['fax', 'phone'],
      is_primary: true,
    });

    const response = (await POST({
      json: async () => ({
        patient_id: 'patient_1',
        case_id: 'case_1',
        request_type: 'care_manager_coordination',
        subject: '訪問日調整',
        content: '来週の訪問日を相談したいです',
      }),
    } as NextRequest))!;

    expect(response.status).toBe(201);
    expect(pickCommunicationRecipientCandidateMock).toHaveBeenCalledWith(
      expect.anything(),
      'org_1',
      {
        caseId: 'case_1',
        patientId: 'patient_1',
        requestType: 'care_manager_coordination',
      },
    );
    expect(communicationRequestCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        recipient_name: '山田 ケアマネ',
        recipient_role: '居宅支援A',
        context_snapshot: {
          external_professional_id: 'external_1',
          external_professional_name: '山田 ケアマネ',
          external_professional_profession_type: 'care_manager',
          preferred_contact_method: 'fax',
          preferred_contact_time: '平日 14:00-17:00',
          recommended_channels: ['fax', 'phone'],
        },
      }),
    });
  });
});
