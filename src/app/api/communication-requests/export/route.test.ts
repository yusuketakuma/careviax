import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const {
  authMock,
  membershipFindFirstMock,
  withOrgContextMock,
  communicationRequestFindManyMock,
  patientFindManyMock,
} = vi.hoisted(() => ({
  authMock: vi.fn(),
  membershipFindFirstMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  communicationRequestFindManyMock: vi.fn(),
  patientFindManyMock: vi.fn(),
}));

vi.mock('@/lib/auth/config', () => ({
  auth: authMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    membership: {
      findFirst: membershipFindFirstMock,
    },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

import { GET } from './route';

function createRequest(url: string) {
  return {
    url,
    headers: {
      get: (key: string) => (key === 'x-org-id' ? 'org_1' : null),
    },
  } as unknown as NextRequest;
}

describe('/api/communication-requests/export GET', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'admin' });
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
        content: '服用方法の確認',
        due_date: new Date('2026-03-30T00:00:00.000Z'),
        requested_at: new Date('2026-03-28T09:30:00.000Z'),
        context_snapshot: { line_count: 2 },
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
  });
});
