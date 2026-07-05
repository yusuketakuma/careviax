import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { expectNoStore } from '@/test/api-response-assertions';

const {
  auditLogFindFirstMock,
  auditLogReviewUpsertMock,
  createAuditLogEntryMock,
  transactionMock,
} = vi.hoisted(() => ({
  auditLogFindFirstMock: vi.fn(),
  auditLogReviewUpsertMock: vi.fn(),
  createAuditLogEntryMock: vi.fn(),
  transactionMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  withAuthContext: (handler: (...args: unknown[]) => Promise<Response>) => {
    return (req: NextRequest, routeContext: { params: Promise<{ id: string }> }) =>
      handler(
        req,
        {
          orgId: 'org_1',
          userId: 'admin_1',
          role: 'admin',
          ipAddress: '127.0.0.1',
          userAgent: 'vitest',
        },
        routeContext,
      );
  },
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    auditLog: {
      findFirst: auditLogFindFirstMock,
    },
    $transaction: transactionMock,
  },
}));

vi.mock('@/lib/audit/audit-entry', () => ({
  createAuditLogEntry: createAuditLogEntryMock,
}));

import { PATCH } from './route';

function createRequest(body: unknown) {
  return new NextRequest('http://localhost/api/audit-logs/audit_1/review', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function createMalformedJsonRequest() {
  return new NextRequest('http://localhost/api/audit-logs/audit_1/review', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: '{"review_state":',
  });
}

function patch(req: NextRequest, id = 'audit_1') {
  return PATCH(req, { params: Promise.resolve({ id }) });
}

describe('/api/audit-logs/[id]/review PATCH', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auditLogFindFirstMock.mockResolvedValue({
      id: 'audit_1',
      org_id: 'org_1',
    });
    auditLogReviewUpsertMock.mockResolvedValue({
      audit_log_id: 'audit_1',
      review_state: 'reviewed',
      reviewed_at: new Date('2026-04-10T00:00:00.000Z'),
      reviewed_by: 'admin_1',
      reason_code: 'admin_reviewed',
    });
    createAuditLogEntryMock.mockResolvedValue({ id: 'audit_review_1' });
    transactionMock.mockImplementation(async (callback) =>
      callback({
        auditLogReview: {
          upsert: auditLogReviewUpsertMock,
        },
      }),
    );
  });

  it('marks an audit log as reviewed and stores only redacted reason-note metadata', async () => {
    const response = (await patch(
      createRequest({
        review_state: 'reviewed',
        reason_code: 'admin_reviewed',
        reason_note: '患者名や電話番号を含みうる自由記載',
      }),
    )) as Response;

    expect(response.status).toBe(200);
    expectNoStore(response);
    expect(auditLogFindFirstMock).toHaveBeenCalledWith({
      where: {
        id: 'audit_1',
        org_id: 'org_1',
      },
      select: {
        id: true,
        org_id: true,
      },
    });
    expect(auditLogReviewUpsertMock).toHaveBeenCalledWith({
      where: {
        org_id_audit_log_id: {
          org_id: 'org_1',
          audit_log_id: 'audit_1',
        },
      },
      create: expect.objectContaining({
        org_id: 'org_1',
        audit_log_id: 'audit_1',
        review_state: 'reviewed',
        reviewed_by: 'admin_1',
        reviewed_at: expect.any(Date),
        reason_code: 'admin_reviewed',
        reason_note: {
          present: true,
          length: expect.any(Number),
          redacted: true,
        },
      }),
      update: expect.objectContaining({
        review_state: 'reviewed',
        reviewed_by: 'admin_1',
        reviewed_at: expect.any(Date),
        reason_code: 'admin_reviewed',
        reason_note: {
          present: true,
          length: expect.any(Number),
          redacted: true,
        },
      }),
      select: {
        audit_log_id: true,
        review_state: true,
        reviewed_at: true,
        reviewed_by: true,
        reason_code: true,
      },
    });
    expect(createAuditLogEntryMock).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ orgId: 'org_1', userId: 'admin_1' }),
      expect.objectContaining({
        action: 'audit_log_reviewed',
        targetType: 'audit_log',
        targetId: 'audit_1',
        changes: expect.objectContaining({
          review_state: 'reviewed',
          reason_code: 'admin_reviewed',
          reason_note_present: true,
          reason_note_redacted: true,
        }),
      }),
    );
    expect(JSON.stringify(auditLogReviewUpsertMock.mock.calls)).not.toContain('患者名');
    await expect(response.json()).resolves.toMatchObject({
      data: {
        audit_log_id: 'audit_1',
        review_state: 'reviewed',
        reviewed_at: '2026-04-10T00:00:00.000Z',
        reviewed_by: 'admin_1',
        reason_code: 'admin_reviewed',
      },
    });
  });

  it('defaults a reviewed audit log reason code when omitted', async () => {
    const response = (await patch(
      createRequest({
        review_state: 'reviewed',
      }),
    )) as Response;

    expect(response.status).toBe(200);
    expect(auditLogReviewUpsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          reason_code: 'admin_reviewed',
        }),
        update: expect.objectContaining({
          reason_code: 'admin_reviewed',
        }),
      }),
    );
    await expect(response.json()).resolves.toMatchObject({
      data: {
        reason_code: 'admin_reviewed',
      },
    });
  });

  it('reopens a reviewed audit log without retaining reviewer fields', async () => {
    auditLogReviewUpsertMock.mockResolvedValue({
      audit_log_id: 'audit_1',
      review_state: 'pending',
      reviewed_at: null,
      reviewed_by: null,
      reason_code: null,
    });

    const response = (await patch(
      createRequest({
        review_state: 'pending',
        reason_code: 'expected_access',
        reason_note: 'pending時は保存しない',
      }),
    )) as Response;

    expect(response.status).toBe(200);
    expect(auditLogReviewUpsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          review_state: 'pending',
          reviewed_by: null,
          reviewed_at: null,
          reason_code: null,
          reason_note: Prisma.DbNull,
        }),
      }),
    );
    expect(createAuditLogEntryMock).toHaveBeenCalledWith(
      expect.any(Object),
      expect.any(Object),
      expect.objectContaining({ action: 'audit_log_review_reopened' }),
    );
    await expect(response.json()).resolves.toMatchObject({
      data: {
        audit_log_id: 'audit_1',
        review_state: 'pending',
        reviewed_at: null,
        reviewed_by: null,
        reason_code: null,
      },
    });
    expect(JSON.stringify(auditLogReviewUpsertMock.mock.calls)).not.toContain(
      'pending時は保存しない',
    );
  });

  it('returns 400 before writes for invalid request bodies', async () => {
    const response = (await patch(
      createRequest({
        review_state: 'done',
      }),
    )) as Response;

    expect(response.status).toBe(400);
    expectNoStore(response);
    expect(auditLogFindFirstMock).not.toHaveBeenCalled();
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it('returns 400 before writes for unknown review reason codes', async () => {
    const response = (await patch(
      createRequest({
        review_state: 'reviewed',
        reason_code: 'free_text_reason',
      }),
    )) as Response;

    expect(response.status).toBe(400);
    expectNoStore(response);
    expect(auditLogFindFirstMock).not.toHaveBeenCalled();
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it('returns 400 before writes for malformed JSON', async () => {
    const response = (await patch(createMalformedJsonRequest())) as Response;

    expect(response.status).toBe(400);
    expectNoStore(response);
    expect(auditLogFindFirstMock).not.toHaveBeenCalled();
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it('returns 404 when the audit log is outside the organization scope', async () => {
    auditLogFindFirstMock.mockResolvedValue(null);

    const response = (await patch(createRequest({ review_state: 'reviewed' }))) as Response;

    expect(response.status).toBe(404);
    expectNoStore(response);
    expect(transactionMock).not.toHaveBeenCalled();
  });
});
