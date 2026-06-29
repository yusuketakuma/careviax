import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  requireAuthContextMock,
  patientFindFirstMock,
  getPatientMcsOverviewMock,
  createAuditLogEntryMock,
  withOrgContextMock,
  upsertOperationalTaskMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  patientFindFirstMock: vi.fn(),
  getPatientMcsOverviewMock: vi.fn(),
  createAuditLogEntryMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  upsertOperationalTaskMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    patient: {
      findFirst: patientFindFirstMock,
    },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/lib/audit/audit-entry', () => ({
  createAuditLogEntry: createAuditLogEntryMock,
}));

vi.mock('@/server/services/patient-mcs', () => ({
  getPatientMcsOverview: getPatientMcsOverviewMock,
  PATIENT_MCS_MAX_MESSAGE_LIMIT: 100,
  PATIENT_MCS_PROFILE_TASK_TYPE: 'patient_mcs_profile',
}));

vi.mock('@/server/services/operational-tasks', () => ({
  upsertOperationalTask: upsertOperationalTaskMock,
}));

import { GET, PATCH } from './route';

function createRequest(
  patientId = 'patient_1',
  query = '',
  init?: {
    method?: string;
    body?: BodyInit;
    headers?: HeadersInit;
  },
) {
  return new NextRequest(
    `http://localhost/api/patients/${patientId}/mcs${query ? `?${query}` : ''}`,
    {
      ...init,
      headers: {
        'x-org-id': 'org_1',
        ...init?.headers,
      },
    },
  );
}

function expectSensitiveNoStore(response: Response) {
  expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
  expect(response.headers.get('Pragma')).toBe('no-cache');
}

describe('/api/patients/[id]/mcs GET', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue({
      ctx: { orgId: 'org_1', userId: 'user_1', role: 'pharmacist' },
    });
    patientFindFirstMock.mockResolvedValue({
      id: 'patient_1',
      name: '青葉 花子',
    });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({ task: { upsert: vi.fn() } }),
    );
    upsertOperationalTaskMock.mockResolvedValue({ id: 'task_1' });
    createAuditLogEntryMock.mockResolvedValue({ id: 'audit_1' });
    getPatientMcsOverviewMock.mockResolvedValue({
      link: {
        id: 'link_1',
        source_url: 'https://www.medical-care.net/patients/1',
        mcs_patient_id: '1',
        mcs_patient_url: 'https://www.medical-care.net/patients/1',
        mcs_project_id: '57886227',
        mcs_project_url: 'https://www.medical-care.net/projects/medical/57886227',
        project_title: '青葉 花子：年長者の里',
        project_memo: '年長者の里',
        member_count: 9,
        last_sync_attempt_at: new Date('2026-04-02T08:00:00.000Z'),
        last_synced_at: new Date('2026-04-02T08:00:00.000Z'),
        last_sync_status: 'success',
        last_sync_error: null,
      },
      summary: {
        id: 'summary_1',
        generation_id: 'gen_1',
        provider: 'openai',
        requested_provider: 'openai',
        is_fallback: false,
        model: 'gpt-5-mini',
        fallback_reason: null,
        headline: '看護師とケアマネから状態共有があります。',
        bullets: ['食欲低下が継続しています。'],
        must_check_today: ['次回訪問時に食事量を確認してください。'],
        suggested_actions: ['水分摂取量を再確認してください。'],
        source_refs: ['4/2 12:12 看護師 篠原 陽子'],
        message_count: 4,
        other_professional_message_count: 3,
        latest_posted_at: new Date('2026-04-02T08:00:00.000Z'),
        generated_at: new Date('2026-04-02T08:05:00.000Z'),
        duration_ms: 820,
      },
      profile: {
        linked_status: 'linked',
        participation_status: 'joined',
        pharmacy_participants: ['薬剤師 佐藤'],
        counterpart_roles: ['visiting_nurse'],
        last_checked_at: new Date('2026-06-16T00:00:00.000Z'),
        note: '毎朝確認',
        updated_at: new Date('2026-06-16T00:05:00.000Z'),
      },
      messages: [
        {
          id: 'message_1',
          source_message_id: '68409128',
          author_name: '篠原 陽子',
          author_role: '看護師',
          author_organization: '年長者の里訪問看護ステーション',
          author_descriptor: '看護師（年長者の里訪問看護ステーション）',
          posted_at: new Date('2026-04-02T03:12:00.000Z'),
          posted_at_label: '12:12',
          body: 'バイタルサインのご報告です。',
          reaction_count: 1,
          reply_count: 0,
          sort_order: 0,
          source_url: 'https://www.medical-care.net/projects/medical/57886227#message-68409128',
          synced_at: new Date('2026-04-02T08:00:00.000Z'),
        },
      ],
    });
  });

  it('returns the patient and saved MCS timeline overview', async () => {
    const response = await GET(createRequest(), {
      params: Promise.resolve({ id: 'patient_1' }),
    });
    if (!response) {
      throw new Error('response was not returned');
    }

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    expect(patientFindFirstMock).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: 'patient_1',
        org_id: 'org_1',
      }),
      select: { id: true, name: true },
    });
    expect(getPatientMcsOverviewMock).toHaveBeenCalledWith({
      orgId: 'org_1',
      patientId: 'patient_1',
    });

    await expect(response.json()).resolves.toMatchObject({
      data: {
        patient: {
          id: 'patient_1',
          name: '青葉 花子',
        },
        link: {
          id: 'link_1',
          mcs_project_id: '57886227',
        },
        profile: {
          linked_status: 'linked',
          participation_status: 'joined',
          pharmacy_participants: ['薬剤師 佐藤'],
          counterpart_roles: ['visiting_nurse'],
          note: '毎朝確認',
        },
        summary: {
          id: 'summary_1',
          provider: 'openai',
          headline: '看護師とケアマネから状態共有があります。',
        },
        messages: [
          {
            id: 'message_1',
            author_name: '篠原 陽子',
            posted_at_label: '12:12',
          },
        ],
      },
    });
  });

  it('passes through a validated limit parameter', async () => {
    const response = await GET(createRequest('patient_1', 'limit=0'), {
      params: Promise.resolve({ id: 'patient_1' }),
    });
    if (!response) {
      throw new Error('response was not returned');
    }

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    expect(getPatientMcsOverviewMock).toHaveBeenCalledWith({
      orgId: 'org_1',
      patientId: 'patient_1',
      limit: 0,
    });
  });

  it('rejects blank patient ids before validating query or loading MCS overview', async () => {
    const response = await GET(createRequest('%20%20', 'limit=200'), {
      params: Promise.resolve({ id: '   ' }),
    });
    if (!response) {
      throw new Error('response was not returned');
    }

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      message: '患者IDが不正です',
    });
    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(getPatientMcsOverviewMock).not.toHaveBeenCalled();
  });

  it('rejects non-sensitive roles', async () => {
    requireAuthContextMock.mockResolvedValue({
      ctx: { orgId: 'org_1', userId: 'user_1', role: 'clerk' },
    });

    const response = await GET(createRequest(), {
      params: Promise.resolve({ id: 'patient_1' }),
    });
    if (!response) {
      throw new Error('response was not returned');
    }

    expect(response.status).toBe(403);
    expectSensitiveNoStore(response);
    expect(getPatientMcsOverviewMock).not.toHaveBeenCalled();
  });

  it('rejects invalid limit values', async () => {
    const response = await GET(createRequest('patient_1', 'limit=200'), {
      params: Promise.resolve({ id: 'patient_1' }),
    });
    if (!response) {
      throw new Error('response was not returned');
    }

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    expect(getPatientMcsOverviewMock).not.toHaveBeenCalled();
  });

  it('rejects malformed limit values before loading the patient', async () => {
    const response = await GET(createRequest('patient_1', 'limit=1e2'), {
      params: Promise.resolve({ id: 'patient_1' }),
    });
    if (!response) {
      throw new Error('response was not returned');
    }

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      message: 'limit は 0 から 100 の整数で指定してください',
    });
    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(getPatientMcsOverviewMock).not.toHaveBeenCalled();
  });

  it('rejects blank limit values before loading the patient', async () => {
    const response = await GET(createRequest('patient_1', 'limit='), {
      params: Promise.resolve({ id: 'patient_1' }),
    });
    if (!response) {
      throw new Error('response was not returned');
    }

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(getPatientMcsOverviewMock).not.toHaveBeenCalled();
  });

  it('returns no-store not-found responses for inaccessible patients', async () => {
    patientFindFirstMock.mockResolvedValueOnce(null);

    const response = await GET(createRequest(), {
      params: Promise.resolve({ id: 'patient_1' }),
    });
    if (!response) {
      throw new Error('response was not returned');
    }

    expect(response.status).toBe(404);
    expectSensitiveNoStore(response);
    expect(getPatientMcsOverviewMock).not.toHaveBeenCalled();
  });

  it('returns a sanitized no-store 500 when MCS overview reads fail', async () => {
    const rawError = '青葉 花子 ワルファリン MCS timeline failure';
    getPatientMcsOverviewMock.mockRejectedValueOnce(new Error(rawError));

    const response = await GET(createRequest(), {
      params: Promise.resolve({ id: 'patient_1' }),
    });
    if (!response) {
      throw new Error('response was not returned');
    }

    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(JSON.stringify(body)).not.toContain(rawError);
    expect(JSON.stringify(body)).not.toContain('青葉 花子');
    expect(JSON.stringify(body)).not.toContain('ワルファリン');
  });

  it('saves the MCS participation profile as an operational task sidecar', async () => {
    const response = await PATCH(
      createRequest('patient_1', '', {
        method: 'PATCH',
        body: JSON.stringify({
          linked_status: 'linked',
          participation_status: 'joined',
          pharmacy_participants: ['薬剤師 佐藤', '事務 鈴木'],
          counterpart_roles: ['physician', 'visiting_nurse'],
          last_checked_at: '2026-06-16T00:00:00.000Z',
          note: '訪問看護投稿を毎朝確認',
        }),
      }),
      {
        params: Promise.resolve({ id: 'patient_1' }),
      },
    );
    if (!response) {
      throw new Error('response was not returned');
    }

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    expect(upsertOperationalTaskMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        orgId: 'org_1',
        taskType: 'patient_mcs_profile',
        status: 'completed',
        dedupeKey: 'patient_mcs_profile:patient_1',
        relatedEntityType: 'patient',
        relatedEntityId: 'patient_1',
        metadata: {
          linked_status: 'linked',
          participation_status: 'joined',
          pharmacy_participants: ['薬剤師 佐藤', '事務 鈴木'],
          counterpart_roles: ['physician', 'visiting_nurse'],
          last_checked_at: '2026-06-16T00:00:00.000Z',
          note: '訪問看護投稿を毎朝確認',
        },
      }),
    );
    expect(createAuditLogEntryMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        orgId: 'org_1',
        userId: 'user_1',
      }),
      {
        action: 'patient_mcs_profile_updated',
        targetType: 'Patient',
        targetId: 'patient_1',
        changes: {
          linked_status: 'linked',
          participation_status: 'joined',
          pharmacy_participants: ['薬剤師 佐藤', '事務 鈴木'],
          counterpart_roles: ['physician', 'visiting_nurse'],
          last_checked_at: '2026-06-16T00:00:00.000Z',
          note: '訪問看護投稿を毎朝確認',
        },
      },
    );
    await expect(response.json()).resolves.toMatchObject({
      data: {
        profile: {
          linked_status: 'linked',
          participation_status: 'joined',
          pharmacy_participants: ['薬剤師 佐藤', '事務 鈴木'],
          counterpart_roles: ['physician', 'visiting_nurse'],
          note: '訪問看護投稿を毎朝確認',
        },
      },
    });
  });

  it('rejects archived patients before saving the MCS participation profile', async () => {
    patientFindFirstMock.mockResolvedValue({
      id: 'patient_1',
      archived_at: new Date('2026-06-01T00:00:00.000Z'),
    });

    const response = await PATCH(
      createRequest('patient_1', '', {
        method: 'PATCH',
        body: JSON.stringify({
          linked_status: 'linked',
          participation_status: 'joined',
          pharmacy_participants: ['薬剤師 佐藤'],
          counterpart_roles: ['physician'],
        }),
      }),
      {
        params: Promise.resolve({ id: 'patient_1' }),
      },
    );
    if (!response) {
      throw new Error('response was not returned');
    }

    expect(response.status).toBe(409);
    expectSensitiveNoStore(response);
    expect(upsertOperationalTaskMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
  });

  it('rejects malformed MCS profile payloads before writing tasks', async () => {
    const response = await PATCH(
      createRequest('patient_1', '', {
        method: 'PATCH',
        body: JSON.stringify({
          linked_status: 'linked',
          participation_status: 'joined',
          pharmacy_participants: ['薬剤師 佐藤'],
          counterpart_roles: ['unknown_role'],
          last_checked_at: 'not-a-date',
        }),
      }),
      {
        params: Promise.resolve({ id: 'patient_1' }),
      },
    );
    if (!response) {
      throw new Error('response was not returned');
    }

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    expect(upsertOperationalTaskMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
  });
});
