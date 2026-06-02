import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { requireAuthContextMock, patientFindFirstMock, getPatientMcsOverviewMock } = vi.hoisted(
  () => ({
    requireAuthContextMock: vi.fn(),
    patientFindFirstMock: vi.fn(),
    getPatientMcsOverviewMock: vi.fn(),
  }),
);

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

vi.mock('@/server/services/patient-mcs', () => ({
  getPatientMcsOverview: getPatientMcsOverviewMock,
  PATIENT_MCS_MAX_MESSAGE_LIMIT: 100,
}));

import { GET } from './route';

function createRequest(patientId = 'patient_1', query = '') {
  return new NextRequest(
    `http://localhost/api/patients/${patientId}/mcs${query ? `?${query}` : ''}`,
    {
      headers: {
        'x-org-id': 'org_1',
      },
    },
  );
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
    expect(patientFindFirstMock).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: 'patient_1',
        org_id: 'org_1',
        AND: expect.any(Array),
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
    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(getPatientMcsOverviewMock).not.toHaveBeenCalled();
  });
});
