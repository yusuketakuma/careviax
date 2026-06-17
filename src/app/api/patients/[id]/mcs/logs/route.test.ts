import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  requireAuthContextMock,
  patientFindFirstMock,
  patientMcsLinkFindUniqueMock,
  taskFindFirstMock,
  taskUpsertMock,
  communicationEventCreateMock,
  createAuditLogEntryMock,
  withOrgContextMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  patientFindFirstMock: vi.fn(),
  patientMcsLinkFindUniqueMock: vi.fn(),
  taskFindFirstMock: vi.fn(),
  taskUpsertMock: vi.fn(),
  communicationEventCreateMock: vi.fn(),
  createAuditLogEntryMock: vi.fn(),
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
    task: {
      findFirst: taskFindFirstMock,
    },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/lib/audit/audit-entry', () => ({
  createAuditLogEntry: createAuditLogEntryMock,
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
    patientFindFirstMock.mockResolvedValue({ id: 'patient_1', name: '田中一郎' });
    patientMcsLinkFindUniqueMock.mockResolvedValue({
      source_url: 'https://www.medical-care.net/patients/2463520',
      mcs_project_url: 'https://www.medical-care.net/projects/medical/57886227',
      project_title: '田中一郎 在宅チーム',
    });
    taskFindFirstMock.mockResolvedValue({
      metadata: {
        linked_status: 'linked',
        participation_status: 'joined',
        pharmacy_participants: ['佐藤薬剤師'],
        counterpart_roles: ['physician', 'visiting_nurse'],
        last_checked_at: '2026-06-01T00:00:00.000Z',
        note: '家族も参加',
      },
    });
    taskUpsertMock.mockResolvedValue({ id: 'task_mcs_profile' });
    createAuditLogEntryMock.mockResolvedValue({ id: 'audit_mcs_check_1' });
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
        task: {
          upsert: taskUpsertMock,
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
      select: { id: true, name: true },
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
    expect(taskUpsertMock).toHaveBeenCalledWith({
      where: {
        org_id_dedupe_key: {
          org_id: 'org_1',
          dedupe_key: 'patient_mcs_profile:patient_1',
        },
      },
      create: expect.objectContaining({
        org_id: 'org_1',
        task_type: 'patient_mcs_profile',
        title: '田中一郎 MCS 連携プロフィール',
        status: 'completed',
        related_entity_type: 'patient',
        related_entity_id: 'patient_1',
        metadata: expect.objectContaining({
          linked_status: 'linked',
          participation_status: 'joined',
          pharmacy_participants: ['佐藤薬剤師'],
          counterpart_roles: ['physician', 'visiting_nurse'],
          last_checked_at: '2026-06-16T00:00:00.000Z',
          note: '家族も参加',
        }),
      }),
      update: expect.objectContaining({
        task_type: 'patient_mcs_profile',
        title: '田中一郎 MCS 連携プロフィール',
        status: 'completed',
        related_entity_type: 'patient',
        related_entity_id: 'patient_1',
        metadata: expect.objectContaining({
          linked_status: 'linked',
          participation_status: 'joined',
          pharmacy_participants: ['佐藤薬剤師'],
          counterpart_roles: ['physician', 'visiting_nurse'],
          last_checked_at: '2026-06-16T00:00:00.000Z',
          note: '家族も参加',
        }),
      }),
    });
    expect(createAuditLogEntryMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        orgId: 'org_1',
        userId: 'user_1',
      }),
      {
        action: 'patient_mcs_check_log_created',
        targetType: 'Patient',
        targetId: 'patient_1',
        changes: {
          content_type: 'instruction_check',
          summary: '訪看からの食欲低下共有を確認',
          next_action: '医師へ服薬状況を確認',
          occurred_at: '2026-06-16T00:00:00.000Z',
          communication_event_id: 'event_1',
        },
      },
    );
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

  it('preserves legacy MCS counterpart role metadata when updating the last check date', async () => {
    taskFindFirstMock.mockResolvedValue({
      metadata: {
        linked_status: 'linked',
        participation_status: 'joined',
        pharmacy_participants: ['佐藤薬剤師'],
        main_counterpart_roles: ['医師', '訪看'],
        last_checked_at: '2026-06-01T00:00:00.000Z',
      },
    });

    const response = await POST(
      createRequest({
        summary: '確認済み',
        occurred_at: '2026-06-17T00:00:00.000Z',
      }),
      { params: Promise.resolve({ id: 'patient_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    expect(taskUpsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          metadata: expect.objectContaining({
            counterpart_roles: ['医師', '訪看'],
            last_checked_at: '2026-06-17T00:00:00.000Z',
          }),
        }),
      }),
    );
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

  it('rejects archived patients before creating MCS log events', async () => {
    patientFindFirstMock.mockResolvedValue({
      id: 'patient_1',
      archived_at: new Date('2026-06-01T00:00:00.000Z'),
    });

    const response = await POST(createRequest({ summary: '確認済み' }), {
      params: Promise.resolve({ id: 'patient_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(409);
    expect(communicationEventCreateMock).not.toHaveBeenCalled();
    expect(taskUpsertMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
  });
});
