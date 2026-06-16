import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  requireAuthContextMock,
  patientFindFirstMock,
  patientMcsLinkFindUniqueMock,
  communicationEventCreateMock,
  withOrgContextMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  patientFindFirstMock: vi.fn(),
  patientMcsLinkFindUniqueMock: vi.fn(),
  communicationEventCreateMock: vi.fn(),
  withOrgContextMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    patient: {
      findFirst: patientFindFirstMock,
    },
    patientMcsLink: {
      findUnique: patientMcsLinkFindUniqueMock,
    },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

import { POST } from './route';

function createRequest(body: unknown) {
  return new NextRequest('http://localhost/api/patients/patient_1/mcs/logs', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-org-id': 'org_1',
    },
    body: JSON.stringify(body),
  });
}

function createMalformedJsonRequest() {
  return new NextRequest('http://localhost/api/patients/patient_1/mcs/logs', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-org-id': 'org_1',
    },
    body: '{"summary":',
  });
}

describe('/api/patients/[id]/mcs/logs POST', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue({
      ctx: { orgId: 'org_1', userId: 'user_1', role: 'pharmacist' },
    });
    patientFindFirstMock.mockResolvedValue({ id: 'patient_1' });
    patientMcsLinkFindUniqueMock.mockResolvedValue({
      source_url: 'https://www.medical-care.net/patients/2463520',
      mcs_project_url: 'https://www.medical-care.net/projects/medical/57886227',
      project_title: '田中一郎 在宅チーム',
    });
    communicationEventCreateMock.mockResolvedValue({
      id: 'event_1',
      event_type: 'mcs_check',
      channel: 'ph_os_share',
      direction: 'inbound',
      occurred_at: new Date('2026-06-16T00:00:00.000Z'),
    });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        communicationEvent: {
          create: communicationEventCreateMock,
        },
      }),
    );
  });

  it('creates a patient-scoped MCS check communication event', async () => {
    const response = await POST(
      createRequest({
        content_type: 'instruction_check',
        summary: '訪看からの食欲低下共有を確認',
        next_action: '医師へ服薬状況を確認',
        occurred_at: '2026-06-16T00:00:00.000Z',
      }),
      { params: Promise.resolve({ id: 'patient_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    expect(patientFindFirstMock).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: 'patient_1',
        org_id: 'org_1',
      }),
      select: { id: true },
    });
    expect(communicationEventCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        org_id: 'org_1',
        patient_id: 'patient_1',
        event_type: 'mcs_check',
        channel: 'ph_os_share',
        direction: 'inbound',
        counterpart_name: '田中一郎 在宅チーム',
        counterpart_contact: 'https://www.medical-care.net/projects/medical/57886227',
        subject: 'MCS 指示確認',
        content: '訪看からの食欲低下共有を確認\n次アクション: 医師へ服薬状況を確認',
        occurred_at: new Date('2026-06-16T00:00:00.000Z'),
      }),
    });
  });

  it('falls back to a safe source URL when the saved project URL is malformed', async () => {
    patientMcsLinkFindUniqueMock.mockResolvedValue({
      source_url: 'https://www.medical-care.net/patients/2463520',
      mcs_project_url: 'not-a-url',
      project_title: '田中一郎 在宅チーム',
    });

    const response = await POST(createRequest({ summary: '確認済み' }), {
      params: Promise.resolve({ id: 'patient_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    expect(communicationEventCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        counterpart_contact: 'https://www.medical-care.net/patients/2463520',
      }),
    });
  });

  it('does not copy unsafe saved MCS URLs into the communication contact field', async () => {
    patientMcsLinkFindUniqueMock.mockResolvedValue({
      source_url: 'https://example.com/patients/2463520',
      mcs_project_url: 'http://www.medical-care.net/projects/medical/57886227',
      project_title: '田中一郎 在宅チーム',
    });

    const response = await POST(createRequest({ summary: '確認済み' }), {
      params: Promise.resolve({ id: 'patient_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    expect(communicationEventCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        counterpart_contact: null,
      }),
    });
  });

  it('rejects non-sensitive roles before loading the patient', async () => {
    requireAuthContextMock.mockResolvedValue({
      ctx: { orgId: 'org_1', userId: 'user_1', role: 'clerk' },
    });

    const response = await POST(createRequest({ summary: '確認済み' }), {
      params: Promise.resolve({ id: 'patient_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(403);
    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(communicationEventCreateMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON before assignment checks or writes', async () => {
    const response = await POST(createMalformedJsonRequest(), {
      params: Promise.resolve({ id: 'patient_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(communicationEventCreateMock).not.toHaveBeenCalled();
  });

  it('rejects blank summaries before writes', async () => {
    const response = await POST(createRequest({ summary: '   ' }), {
      params: Promise.resolve({ id: 'patient_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(communicationEventCreateMock).not.toHaveBeenCalled();
  });

  it('returns 404 when the patient is not assigned or not found', async () => {
    patientFindFirstMock.mockResolvedValue(null);

    const response = await POST(createRequest({ summary: '確認済み' }), {
      params: Promise.resolve({ id: 'patient_unknown' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(404);
    expect(communicationEventCreateMock).not.toHaveBeenCalled();
  });
});
