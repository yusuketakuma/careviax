import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  authMock,
  membershipFindFirstMock,
  withOrgContextMock,
  communicationRequestFindManyMock,
  patientFindManyMock,
  careCaseFindManyMock,
} = vi.hoisted(() => ({
  authMock: vi.fn(),
  membershipFindFirstMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  communicationRequestFindManyMock: vi.fn(),
  patientFindManyMock: vi.fn(),
  careCaseFindManyMock: vi.fn(),
}));

vi.mock('@/lib/auth/config', () => ({
  auth: authMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    membership: {
      findFirst: membershipFindFirstMock,
    },
    patient: {
      findMany: patientFindManyMock,
    },
    careCase: {
      findMany: careCaseFindManyMock,
    },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

import { GET as rawGET } from './route';

const emptyRouteContext = { params: Promise.resolve({}) };

const GET = (req: NextRequest) => rawGET(req, emptyRouteContext);

function createRequest(url: string) {
  return new NextRequest(url, {
    headers: {
      'x-org-id': 'org_1',
    },
  });
}

describe('/api/communication-requests/export GET', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'admin' });
    careCaseFindManyMock.mockResolvedValue([{ id: 'case_1' }]);
    communicationRequestFindManyMock.mockResolvedValue([
      {
        id: 'request_1',
        patient_id: 'patient_1',
        request_type: 'inquiry',
        recipient_name: '在宅主治医',
        recipient_role: '医師/FAX',
        related_entity_type: 'medication_cycle',
        related_entity_id: 'cycle_1',
        status: 'responded',
        subject: '疑義照会',
        content: '服用方法の確認。電話 03-1234-5678 へ折り返し希望',
        due_date: new Date('2026-03-30T00:00:00.000Z'),
        requested_at: new Date('2026-03-28T09:30:00.000Z'),
        context_snapshot: {
          line_count: 2,
          phone: '03-1234-5678',
          address: '東京都千代田区1-1-1',
          note: '家族へ事前共有',
        },
        responses: [
          {
            responder_name: '在宅主治医',
            responded_at: new Date('2026-03-28T11:00:00.000Z'),
          },
        ],
      },
    ]);
    patientFindManyMock.mockResolvedValue([{ id: 'patient_1', name: '山田 太郎' }]);
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        communicationRequest: {
          findMany: communicationRequestFindManyMock,
        },
        patient: {
          findMany: patientFindManyMock,
        },
      }),
    );
  });

  it('returns collaborator handoff csv with patient and response fields', async () => {
    const response = await GET(
      createRequest('http://localhost/api/communication-requests/export?status=responded'),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toContain('text/csv');
    const body = await response.text();
    expect(body).toContain('patient_name');
    expect(body).toContain('"山田 太郎"');
    expect(body).toContain('"医師/FAX"');
    expect(body).toContain('"handoff-prep"');
    expect(body).toContain('03-1234-5678');
    expect(body).toContain('東京都千代田区1-1-1');
  });

  it('returns an external redacted csv without patient names, snapshots, or free text', async () => {
    const response = await GET(
      createRequest(
        'http://localhost/api/communication-requests/export?status=responded&profile=external',
      ),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Disposition')).toContain(
      'communication_requests_responded_external.csv',
    );
    const body = await response.text();
    const [header] = body.split('\n');
    expect(header).toBe(
      [
        'id',
        'request_type',
        'status',
        'recipient_role',
        'related_entity_type',
        'requested_at',
        'due_date',
        'latest_responded_at',
        'fax_ready',
        'nsips_csv_profile',
        'redaction_profile',
      ].join(','),
    );
    expect(body).toContain('"handoff-external-redacted"');
    expect(body).toContain('"external"');
    expect(body).not.toContain('patient_name');
    expect(body).not.toContain('patient_1');
    expect(body).not.toContain('山田 太郎');
    expect(body).not.toContain('服用方法の確認');
    expect(body).not.toContain('03-1234-5678');
    expect(body).not.toContain('東京都千代田区1-1-1');
    expect(body).not.toContain('家族へ事前共有');
    expect(patientFindManyMock).not.toHaveBeenCalled();
    const select = communicationRequestFindManyMock.mock.calls[0]?.[0]?.select;
    expect(select).toMatchObject({
      id: true,
      request_type: true,
      recipient_role: true,
      related_entity_type: true,
      status: true,
      due_date: true,
      requested_at: true,
      responses: {
        select: {
          responded_at: true,
        },
      },
    });
    expect(select).not.toHaveProperty('patient_id');
    expect(select).not.toHaveProperty('recipient_name');
    expect(select).not.toHaveProperty('related_entity_id');
    expect(select).not.toHaveProperty('subject');
    expect(select).not.toHaveProperty('content');
    expect(select).not.toHaveProperty('context_snapshot');
    expect(select.responses.select).not.toHaveProperty('responder_name');
  });

  it('rejects an invalid status before resolving assignment scope', async () => {
    const response = await GET(
      createRequest('http://localhost/api/communication-requests/export?status=archived'),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: {
        status: ['対応していないステータスです'],
      },
    });
    expect(careCaseFindManyMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(communicationRequestFindManyMock).not.toHaveBeenCalled();
  });

  it('rejects an invalid export profile before resolving assignment scope', async () => {
    const response = await GET(
      createRequest('http://localhost/api/communication-requests/export?profile=partner'),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: {
        profile: ['internal または external を指定してください'],
      },
    });
    expect(careCaseFindManyMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(communicationRequestFindManyMock).not.toHaveBeenCalled();
  });
});
