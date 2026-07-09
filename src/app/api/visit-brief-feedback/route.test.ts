import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { requireAuthContextMock, withOrgContextMock, auditLogCreateMock, patientFindFirstMock } =
  vi.hoisted(() => ({
    requireAuthContextMock: vi.fn(),
    withOrgContextMock: vi.fn(),
    auditLogCreateMock: vi.fn(),
    patientFindFirstMock: vi.fn(),
  }));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

import { POST } from './route';
import { expectSensitiveNoStore } from '@/test/api-response-assertions';

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
        patient: {
          findFirst: patientFindFirstMock,
        },
        auditLog: {
          create: auditLogCreateMock,
        },
      }),
    );
    patientFindFirstMock.mockResolvedValue({ id: 'patient_1' });
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
    expectSensitiveNoStore(response);
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
    expect(patientFindFirstMock).toHaveBeenCalledWith({
      where: {
        id: 'patient_1',
        org_id: 'corg1234567890123456789012',
      },
      select: { id: true },
    });
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

  it('returns a no-store not-found response without auditing inaccessible patients', async () => {
    patientFindFirstMock.mockResolvedValueOnce(null);

    const response = (await POST(
      createRequest({
        patient_id: 'patient_outside_scope',
        context: 'patient',
        generation_id: 'gen_1',
        summary_kind: 'ai',
        rating: 'helpful',
      }),
    ))!;

    expect(response.status).toBe(404);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_NOT_FOUND',
      message: '患者が見つかりません',
    });
    expect(patientFindFirstMock).toHaveBeenCalledWith({
      where: {
        id: 'patient_outside_scope',
        org_id: 'corg1234567890123456789012',
      },
      select: { id: true },
    });
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('rejects oversized feedback identifiers before patient lookup or audit logging', async () => {
    const response = (await POST(
      createRequest({
        patient_id: 'p'.repeat(192),
        context: 'patient',
        generation_id: 'g'.repeat(192),
        summary_kind: 'rule',
        rating: 'needs_review',
      }),
    ))!;

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
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

  it('returns a sanitized no-store 500 when feedback auth lookup fails unexpectedly', async () => {
    requireAuthContextMock.mockRejectedValueOnce(
      new Error('患者 山田花子 090-1234-5678 raw visit brief feedback auth detail'),
    );

    const response = (await POST(
      createRequest({
        patient_id: 'patient_1',
        context: 'patient',
        generation_id: 'gen_1',
        summary_kind: 'ai',
        rating: 'helpful',
      }),
    ))!;

    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({
      code: 'INTERNAL_ERROR',
      message: 'サーバー内部でエラーが発生しました',
    });
    expect(JSON.stringify(body)).not.toContain('山田花子');
    expect(JSON.stringify(body)).not.toContain('090-1234-5678');
    expect(JSON.stringify(body)).not.toContain('raw visit brief feedback auth detail');
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('returns a sanitized no-store 500 when feedback audit logging fails unexpectedly', async () => {
    withOrgContextMock.mockRejectedValueOnce(
      new Error('患者 山田花子 raw corrected summary audit failure detail'),
    );

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

    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({
      code: 'INTERNAL_ERROR',
      message: 'サーバー内部でエラーが発生しました',
    });
    expect(JSON.stringify(body)).not.toContain('山田花子');
    expect(JSON.stringify(body)).not.toContain('raw corrected summary audit failure detail');
    expect(JSON.stringify(body)).not.toContain('夕食後薬の飲み忘れ');
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });
});
