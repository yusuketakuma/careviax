import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { requireAuthContextMock, withOrgContextMock, auditLogCreateMock } = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  auditLogCreateMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

import { POST } from './route';

function createRequest(body: unknown) {
  return new NextRequest('http://localhost/api/visit-brief-feedback', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

function createMalformedJsonRequest() {
  return new NextRequest('http://localhost/api/visit-brief-feedback', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: '{',
  });
}

describe('/api/visit-brief-feedback POST', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue({
      ctx: {
        orgId: 'corg1234567890123456789012',
        userId: 'user_1',
        role: 'pharmacist',
      },
    });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        auditLog: {
          create: auditLogCreateMock,
        },
      }),
    );
    auditLogCreateMock.mockResolvedValue({ id: 'audit_1' });
  });

  it('records visit brief feedback through RLS context', async () => {
    const response = (await POST(
      createRequest({
        patient_id: 'patient_1',
        context: 'patient',
        generation_id: 'gen_1',
        summary_kind: 'ai',
        rating: 'helpful',
        comment: '十分に役立った',
      }),
    ))!;

    expect(response.status).toBe(201);
    expect(withOrgContextMock).toHaveBeenCalledWith(
      'corg1234567890123456789012',
      expect.any(Function),
      expect.objectContaining({
        requestContext: expect.objectContaining({
          orgId: 'corg1234567890123456789012',
          userId: 'user_1',
        }),
      }),
    );
    expect(auditLogCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        org_id: 'corg1234567890123456789012',
        actor_id: 'user_1',
        action: 'visit_brief_feedback_helpful',
        target_type: 'visit_brief_feedback',
        target_id: 'gen_1',
      }),
    });
  });

  it('records the corrected summary for 一部修正する into the audit changes', async () => {
    const response = (await POST(
      createRequest({
        patient_id: 'patient_1',
        context: 'patient',
        generation_id: 'gen_1',
        summary_kind: 'ai',
        rating: 'needs_review',
        comment: '一部修正する',
        corrected_summary: '夕食後薬の飲み忘れ確認を最優先にしてください。',
      }),
    ))!;

    expect(response.status).toBe(201);
    expect(auditLogCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'visit_brief_feedback_needs_review',
        target_type: 'visit_brief_feedback',
        changes: expect.objectContaining({
          comment: '一部修正する',
          corrected_summary: '夕食後薬の飲み忘れ確認を最優先にしてください。',
        }),
      }),
    });
  });

  it('rejects an empty corrected_summary string', async () => {
    const response = (await POST(
      createRequest({
        patient_id: 'patient_1',
        context: 'patient',
        generation_id: 'gen_1',
        summary_kind: 'ai',
        rating: 'needs_review',
        comment: '一部修正する',
        corrected_summary: '',
      }),
    ))!;

    expect(response.status).toBe(400);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('rejects non-object feedback payloads before audit logging', async () => {
    const response = (await POST(createRequest([])))!;

    expect(response.status).toBe(400);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON before audit logging', async () => {
    const response = (await POST(createMalformedJsonRequest()))!;

    expect(response.status).toBe(400);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });
});
