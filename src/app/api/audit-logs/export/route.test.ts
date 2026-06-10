import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { authMock, membershipFindFirstMock, findManyMock, recordDataExportAuditMock } = vi.hoisted(
  () => ({
    authMock: vi.fn(),
    membershipFindFirstMock: vi.fn(),
    findManyMock: vi.fn(),
    recordDataExportAuditMock: vi.fn(),
  }),
);

vi.mock('@/lib/auth/config', () => ({
  auth: authMock,
}));

vi.mock('@/lib/db', () => ({
  prisma: {
    membership: {
      findFirst: membershipFindFirstMock,
    },
    auditLog: {
      findMany: findManyMock,
    },
  },
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    membership: {
      findFirst: membershipFindFirstMock,
    },
    auditLog: {
      findMany: findManyMock,
    },
  },
}));

vi.mock('@/server/services/export-audit', () => ({
  recordDataExportAudit: recordDataExportAuditMock,
}));

import { GET } from './route';

function createRequest(headers?: Record<string, string>, search = 'format=csv') {
  return new NextRequest(`http://localhost/api/audit-logs/export?${search}`, {
    headers,
  });
}

describe('/api/audit-logs/export GET', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findManyMock.mockResolvedValue([
      {
        id: 'audit_1',
        org_id: 'org_1',
        actor_id: 'user_1',
        action: 'export',
        target_type: 'visit_record',
        target_id: 'visit_1',
        changes: { count: 1 },
        ip_address: '127.0.0.1',
        user_agent: 'vitest',
        created_at: new Date('2026-03-28T00:00:00.000Z'),
      },
    ]);
  });

  it('returns csv payload with UI-compatible filters', async () => {
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'admin' });
    recordDataExportAuditMock.mockResolvedValue(undefined);

    const response = (await GET(
      createRequest(
        { 'x-org-id': 'org_1' },
        'format=csv&actor=user_1&target_type=visit_record&date_from=2026-03-01&date_to=2026-03-31',
      ),
    )) as Response;

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/csv');
    expect(findManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          actor_id: 'user_1',
          target_type: 'visit_record',
          created_at: {
            gte: new Date('2026-03-01T00:00:00.000Z'),
            lte: new Date('2026-03-31T23:59:59.999Z'),
          },
        }),
      }),
    );

    const body = await response.text();
    expect(body).toContain('"audit_1"');
    expect(body).toContain('"visit_record"');
    expect(recordDataExportAuditMock).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        targetType: 'audit_log',
        format: 'csv',
        recordCount: 1,
      }),
    );
  });

  it('returns json payload when requested', async () => {
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'admin' });

    const response = (await GET(createRequest({ 'x-org-id': 'org_1' }, 'format=json'))) as Response;

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');
    await expect(response.json()).resolves.toEqual([
      expect.objectContaining({
        id: 'audit_1',
        action: 'export',
      }),
    ]);
  });

  it('redacts proposal reject free text from json export payloads', async () => {
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'admin' });
    findManyMock.mockResolvedValue([
      {
        id: 'audit_reject_1',
        org_id: 'org_1',
        actor_id: 'user_1',
        action: 'visit_schedule_proposal_rejected',
        target_type: 'VisitScheduleProposal',
        target_id: 'proposal_1',
        changes: {
          reject_reason: '東京都港区2-2-2 090-1234-5678 アムロジピン 処方詳細',
        },
        ip_address: '127.0.0.1',
        user_agent: 'vitest',
        created_at: new Date('2026-04-09T00:00:00.000Z'),
      },
    ]);

    const response = (await GET(createRequest({ 'x-org-id': 'org_1' }, 'format=json'))) as Response;
    const body = await response.json();
    const bodyText = JSON.stringify(body);

    expect(response.status).toBe(200);
    expect(body[0].changes).toMatchObject({
      reject_reason: '却下理由の自由記載は出力対象外です',
      reject_reason_redacted: true,
    });
    expect(bodyText).not.toContain('東京都港区2-2-2');
    expect(bodyText).not.toContain('090-1234-5678');
    expect(bodyText).not.toContain('アムロジピン');
    expect(bodyText).not.toContain('処方詳細');
  });

  it('redacts proposal reject free text from csv export payloads', async () => {
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'admin' });
    findManyMock.mockResolvedValue([
      {
        id: 'audit_reject_1',
        org_id: 'org_1',
        actor_id: 'user_1',
        action: 'visit_schedule_proposal_rejected',
        target_type: 'VisitScheduleProposal',
        target_id: 'proposal_1',
        changes: {
          reject_reason: '東京都港区2-2-2 090-1234-5678 アムロジピン 処方詳細',
        },
        ip_address: '127.0.0.1',
        user_agent: 'vitest',
        created_at: new Date('2026-04-09T00:00:00.000Z'),
      },
    ]);

    const response = (await GET(createRequest({ 'x-org-id': 'org_1' }, 'format=csv'))) as Response;
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain('却下理由の自由記載は出力対象外です');
    expect(body).toContain('reject_reason_redacted');
    expect(body).not.toContain('東京都港区2-2-2');
    expect(body).not.toContain('090-1234-5678');
    expect(body).not.toContain('アムロジピン');
    expect(body).not.toContain('処方詳細');
  });
});
