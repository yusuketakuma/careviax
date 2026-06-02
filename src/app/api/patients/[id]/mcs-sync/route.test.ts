import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  requireAuthContextMock,
  patientFindFirstMock,
  syncPatientMcsTimelineMock,
  PatientMcsSyncErrorMock,
} = vi.hoisted(() => {
  class PatientMcsSyncError extends Error {
    kind: 'validation' | 'conflict' | 'external';

    constructor(message: string, kind: 'validation' | 'conflict' | 'external' = 'external') {
      super(message);
      this.kind = kind;
    }
  }

  return {
    requireAuthContextMock: vi.fn(),
    patientFindFirstMock: vi.fn(),
    syncPatientMcsTimelineMock: vi.fn(),
    PatientMcsSyncErrorMock: PatientMcsSyncError,
  };
});

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
  PatientMcsSyncError: PatientMcsSyncErrorMock,
  syncPatientMcsTimeline: syncPatientMcsTimelineMock,
}));

import { POST } from './route';

function createRequest(body: unknown = {}) {
  return new NextRequest('http://localhost/api/patients/patient_1/mcs-sync', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-org-id': 'org_1',
    },
    body: JSON.stringify(body),
  });
}

function createMalformedJsonRequest() {
  return new NextRequest('http://localhost/api/patients/patient_1/mcs-sync', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-org-id': 'org_1',
    },
    body: '{"source_url":',
  });
}

describe('/api/patients/[id]/mcs-sync POST', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue({
      ctx: { orgId: 'org_1', userId: 'user_1', role: 'pharmacist' },
    });
    patientFindFirstMock.mockResolvedValue({ id: 'patient_1' });
    syncPatientMcsTimelineMock.mockResolvedValue({
      importedCount: 2,
      latestMessageAt: '2026-04-02T08:00:00.000Z',
      link: {
        id: 'link_1',
      },
      summary: {
        id: 'summary_1',
        provider: 'rule',
        headline: '看護師から共有があります。',
      },
    });
  });

  it('rejects non-object sync payloads before loading the patient', async () => {
    const response = await POST(createRequest([]), {
      params: Promise.resolve({ id: 'patient_1' }),
    });
    if (!response) {
      throw new Error('response was not returned');
    }

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: 'リクエストボディが不正です',
    });
    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(syncPatientMcsTimelineMock).not.toHaveBeenCalled();
  });

  it('rejects blank patient ids before parsing sync payloads or loading the patient', async () => {
    const response = await POST(createMalformedJsonRequest(), {
      params: Promise.resolve({ id: '\t\n' }),
    });
    if (!response) {
      throw new Error('response was not returned');
    }

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '患者IDが不正です',
    });
    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(syncPatientMcsTimelineMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON sync payloads before loading the patient', async () => {
    const response = await POST(createMalformedJsonRequest(), {
      params: Promise.resolve({ id: 'patient_1' }),
    });
    if (!response) {
      throw new Error('response was not returned');
    }

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: 'リクエストボディが不正です',
    });
    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(syncPatientMcsTimelineMock).not.toHaveBeenCalled();
  });

  it('returns a sync result on success', async () => {
    const response = await POST(
      createRequest({
        source_url: 'https://www.medical-care.net/patients/2463520',
      }),
      {
        params: Promise.resolve({ id: 'patient_1' }),
      },
    );
    if (!response) {
      throw new Error('response was not returned');
    }

    expect(response.status).toBe(200);
    expect(syncPatientMcsTimelineMock).toHaveBeenCalledWith({
      orgId: 'org_1',
      patientId: 'patient_1',
      userId: 'user_1',
      sourceUrl: 'https://www.medical-care.net/patients/2463520',
    });
    await expect(response.json()).resolves.toMatchObject({
      data: {
        importedCount: 2,
        summary: {
          id: 'summary_1',
          provider: 'rule',
        },
      },
    });
  });

  it('returns 404 when patient is not found or not assigned', async () => {
    patientFindFirstMock.mockResolvedValue(null);

    const response = await POST(
      createRequest({
        source_url: 'https://www.medical-care.net/patients/2463520',
      }),
      {
        params: Promise.resolve({ id: 'patient_unknown' }),
      },
    );
    if (!response) {
      throw new Error('response was not returned');
    }

    expect(response.status).toBe(404);
    expect(syncPatientMcsTimelineMock).not.toHaveBeenCalled();
  });

  it('rejects users without sensitive patient access', async () => {
    requireAuthContextMock.mockResolvedValue({
      ctx: { orgId: 'org_1', userId: 'user_1', role: 'clerk' },
    });

    const response = await POST(createRequest(), {
      params: Promise.resolve({ id: 'patient_1' }),
    });
    if (!response) {
      throw new Error('response was not returned');
    }

    expect(response.status).toBe(403);
    expect(syncPatientMcsTimelineMock).not.toHaveBeenCalled();
  });

  it('validates the request body', async () => {
    const response = await POST(
      createRequest({
        source_url: 'not-a-url',
      }),
      {
        params: Promise.resolve({ id: 'patient_1' }),
      },
    );
    if (!response) {
      throw new Error('response was not returned');
    }

    expect(response.status).toBe(400);
    expect(syncPatientMcsTimelineMock).not.toHaveBeenCalled();
  });

  it('rejects unsupported MCS paths before sync', async () => {
    const response = await POST(
      createRequest({
        source_url: 'https://www.medical-care.net/home',
      }),
      {
        params: Promise.resolve({ id: 'patient_1' }),
      },
    );
    if (!response) {
      throw new Error('response was not returned');
    }

    expect(response.status).toBe(400);
    expect(syncPatientMcsTimelineMock).not.toHaveBeenCalled();
  });

  it('maps sync conflicts to 409', async () => {
    syncPatientMcsTimelineMock.mockRejectedValue(
      new PatientMcsSyncErrorMock(
        'MCS の患者名「別患者」 が対象患者「青葉 花子」と一致しません',
        'conflict',
      ),
    );

    const response = await POST(
      createRequest({
        source_url: 'https://www.medical-care.net/projects/medical/57886227',
      }),
      {
        params: Promise.resolve({ id: 'patient_1' }),
      },
    );
    if (!response) {
      throw new Error('response was not returned');
    }

    expect(response.status).toBe(409);
  });

  it('maps external sync failures to 502', async () => {
    syncPatientMcsTimelineMock.mockRejectedValue(
      new PatientMcsSyncErrorMock(
        'Medical Care Station にログイン済みの Chrome セッションが見つかりません',
        'external',
      ),
    );

    const response = await POST(createRequest(), {
      params: Promise.resolve({ id: 'patient_1' }),
    });
    if (!response) {
      throw new Error('response was not returned');
    }

    expect(response.status).toBe(502);
  });
});
