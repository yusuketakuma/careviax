import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { expectNoStore } from '@/test/api-response-assertions';

const {
  requireAuthContextMock,
  withOrgContextMock,
  inquiryRecordFindFirstMock,
  prescriptionLineFindFirstMock,
  resolveOperationalTasksMock,
  notifyWorkflowMutationMock,
  loggerErrorMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  inquiryRecordFindFirstMock: vi.fn(),
  prescriptionLineFindFirstMock: vi.fn(),
  resolveOperationalTasksMock: vi.fn(),
  notifyWorkflowMutationMock: vi.fn(),
  loggerErrorMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    inquiryRecord: {
      findFirst: inquiryRecordFindFirstMock,
    },
    prescriptionLine: {
      findFirst: prescriptionLineFindFirstMock,
    },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/server/services/operational-tasks', () => ({
  resolveOperationalTasks: resolveOperationalTasksMock,
}));

vi.mock('@/server/services/workflow-dashboard-cache', () => ({
  notifyWorkflowMutation: notifyWorkflowMutationMock,
}));

vi.mock('@/lib/utils/logger', () => ({
  logger: { error: loggerErrorMock },
}));

import { PATCH } from './route';

function createRequest(body: unknown) {
  return new NextRequest('http://localhost/api/inquiry-records/inquiry_1', {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

function createMalformedJsonRequest() {
  return new NextRequest('http://localhost/api/inquiry-records/inquiry_1', {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
    },
    body: '{"result":',
  });
}

function expectNoInquiryPatchSideEffects() {
  expect(inquiryRecordFindFirstMock).not.toHaveBeenCalled();
  expect(prescriptionLineFindFirstMock).not.toHaveBeenCalled();
  expect(withOrgContextMock).not.toHaveBeenCalled();
  expect(resolveOperationalTasksMock).not.toHaveBeenCalled();
  expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
}

describe('/api/inquiry-records/[id] PATCH', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue({
      ctx: {
        orgId: 'org_1',
        userId: 'user_1',
        role: 'pharmacist',
      },
    });
    prescriptionLineFindFirstMock.mockResolvedValue({
      id: 'line_1',
      drug_name: 'アムロジピン錠5mg',
      drug_code: 'YJ123',
      dose: '1錠',
      frequency: '1日1回',
      days: 7,
      packaging_instructions: null,
      route: 'internal',
      updated_at: new Date('2026-01-01T00:00:00.000Z'),
    });
  });

  it('wraps authentication failures with no-store headers', async () => {
    requireAuthContextMock.mockResolvedValueOnce({
      response: Response.json({ code: 'AUTH_UNAUTHENTICATED' }, { status: 401 }),
    });

    const response = await PATCH(
      createRequest({
        result: 'unchanged',
      }),
      { params: Promise.resolve({ id: 'inquiry_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(401);
    expectNoStore(response);
    expect(inquiryRecordFindFirstMock).not.toHaveBeenCalled();
  });

  it('rejects non-object patch payloads before loading the inquiry record', async () => {
    const response = await PATCH(createRequest([]), {
      params: Promise.resolve({ id: 'inquiry_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expectNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      message: 'リクエストボディが不正です',
    });
    expect(inquiryRecordFindFirstMock).not.toHaveBeenCalled();
    expect(prescriptionLineFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(resolveOperationalTasksMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON patch payloads before loading the inquiry record', async () => {
    const response = await PATCH(createMalformedJsonRequest(), {
      params: Promise.resolve({ id: 'inquiry_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expectNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      message: 'リクエストボディが不正です',
    });
    expect(inquiryRecordFindFirstMock).not.toHaveBeenCalled();
    expect(prescriptionLineFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(resolveOperationalTasksMock).not.toHaveBeenCalled();
  });

  it('rejects blank inquiry record ids before parsing or loading the inquiry record', async () => {
    const response = await PATCH(
      createRequest({
        result: 'unchanged',
      }),
      { params: Promise.resolve({ id: '   ' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expectNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '疑義照会記録IDが不正です',
    });
    expect(inquiryRecordFindFirstMock).not.toHaveBeenCalled();
    expect(prescriptionLineFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(resolveOperationalTasksMock).not.toHaveBeenCalled();
  });

  it.each([
    [
      'changed with prescription-line update',
      {
        result: 'changed',
        change_detail: '1日2回へ変更',
        line_update: {
          frequency: '1日2回',
          days: 14,
        },
      },
    ],
    ['unchanged final outcome', { result: 'unchanged', change_detail: '変更なし' }],
    ['pending reopen outcome', { result: 'pending', change_detail: '再照会' }],
    ['resolved timestamp write', { resolved_at: '2026-01-02' }],
  ])('denies pharmacist trainees before inquiry lookup for %s', async (_label, body) => {
    requireAuthContextMock.mockResolvedValueOnce({
      ctx: {
        orgId: 'org_1',
        userId: 'trainee_1',
        role: 'pharmacist_trainee',
      },
    });

    const response = await PATCH(createRequest(body), {
      params: Promise.resolve({ id: 'inquiry_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(403);
    expectNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'AUTH_FORBIDDEN',
      message: '疑義照会結果の確定・処方反映権限がありません',
    });
    expectNoInquiryPatchSideEffects();
  });

  it('denies pharmacist trainees from editing finalized inquiry metadata before writes', async () => {
    requireAuthContextMock.mockResolvedValueOnce({
      ctx: {
        orgId: 'org_1',
        userId: 'trainee_1',
        role: 'pharmacist_trainee',
      },
    });
    inquiryRecordFindFirstMock.mockResolvedValue({
      id: 'inquiry_1',
      cycle_id: 'cycle_1',
      line_id: null,
      issue_id: 'issue_1',
      result: 'changed',
      updated_at: new Date('2026-01-01T00:00:00.000Z'),
      cycle: { overall_status: 'inquiry_resolved' },
    });

    const response = await PATCH(
      createRequest({
        change_detail: '最終判断を書き換え',
      }),
      { params: Promise.resolve({ id: 'inquiry_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(403);
    expectNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'AUTH_FORBIDDEN',
      message: '確定済み疑義照会記録の更新権限がありません',
    });
    expect(inquiryRecordFindFirstMock).toHaveBeenCalled();
    expect(prescriptionLineFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(resolveOperationalTasksMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('allows pharmacist trainees to persist non-final inquiry notes without clinical workflow side effects', async () => {
    requireAuthContextMock.mockResolvedValueOnce({
      ctx: {
        orgId: 'org_1',
        userId: 'trainee_1',
        role: 'pharmacist_trainee',
      },
    });
    inquiryRecordFindFirstMock.mockResolvedValue({
      id: 'inquiry_1',
      cycle_id: 'cycle_1',
      line_id: null,
      issue_id: null,
      result: 'pending',
      updated_at: new Date('2026-01-01T00:00:00.000Z'),
      cycle: { overall_status: 'inquiry_pending' },
    });

    const inquiryUpdateMock = vi.fn().mockResolvedValue({ count: 1 });
    const inquiryFindUniqueMock = vi.fn().mockResolvedValue({
      id: 'inquiry_1',
      result: 'pending',
      change_detail: '医師回答待ち。薬剤師へ確認依頼済み',
    });
    const auditLogCreateMock = vi.fn().mockResolvedValue({ id: 'audit_1' });
    const cycleUpdateMock = vi.fn().mockResolvedValue({});
    const communicationUpdateMock = vi.fn().mockResolvedValue({ count: 0 });
    const medicationIssueUpdateMock = vi.fn().mockResolvedValue({});

    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        prescriptionLine: {
          findFirst: vi.fn(),
          updateMany: vi.fn(),
        },
        inquiryRecord: {
          updateMany: inquiryUpdateMock,
          findUnique: inquiryFindUniqueMock,
          count: vi.fn(),
        },
        medicationCycle: {
          update: cycleUpdateMock,
        },
        communicationRequest: {
          updateMany: communicationUpdateMock,
        },
        medicationIssue: {
          update: medicationIssueUpdateMock,
        },
        cycleTransitionLog: {
          create: vi.fn(),
        },
        auditLog: {
          create: auditLogCreateMock,
        },
      }),
    );

    const response = await PATCH(
      createRequest({
        change_detail: '医師回答待ち。薬剤師へ確認依頼済み',
      }),
      { params: Promise.resolve({ id: 'inquiry_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expectNoStore(response);
    expect(inquiryUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          change_detail: '医師回答待ち。薬剤師へ確認依頼済み',
        },
      }),
    );
    expect(cycleUpdateMock).not.toHaveBeenCalled();
    expect(communicationUpdateMock).not.toHaveBeenCalled();
    expect(medicationIssueUpdateMock).not.toHaveBeenCalled();
    expect(resolveOperationalTasksMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'inquiry_record_updated',
        changes: expect.objectContaining({
          change_detail_changed: true,
          result_before: 'pending',
          result_after: 'pending',
          cycle_status_after: null,
        }),
      }),
    });
    expect(notifyWorkflowMutationMock).toHaveBeenCalledWith({
      orgId: 'org_1',
      payload: {
        source: 'inquiry_records_update',
        inquiry_id: 'inquiry_1',
        cycle_id: 'cycle_1',
        result: null,
        line_update_requested: false,
        line_linked: false,
        issue_linked: false,
      },
    });
    expect(JSON.stringify(auditLogCreateMock.mock.calls)).not.toContain(
      '医師回答待ち。薬剤師へ確認依頼済み',
    );
    expect(JSON.stringify(notifyWorkflowMutationMock.mock.calls)).not.toContain(
      '医師回答待ち。薬剤師へ確認依頼済み',
    );
  });

  it('denies records outside the cycle assignment scope before writing', async () => {
    inquiryRecordFindFirstMock.mockResolvedValue(null);

    const response = await PATCH(
      createRequest({
        result: 'unchanged',
      }),
      { params: Promise.resolve({ id: 'inquiry_unassigned' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(404);
    expect(inquiryRecordFindFirstMock).toHaveBeenCalledWith({
      where: {
        id: 'inquiry_unassigned',
        org_id: 'org_1',
      },
      select: {
        id: true,
        cycle_id: true,
        line_id: true,
        issue_id: true,
        result: true,
        updated_at: true,
        cycle: {
          select: {
            overall_status: true,
          },
        },
      },
    });
    expect(prescriptionLineFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
  });

  it('returns a fixed no-store 500 when inquiry lookup fails unexpectedly', async () => {
    const unsafeError = new Error('raw patient inquiry secret');
    unsafeError.name = 'InquiryPatientSecretError';
    inquiryRecordFindFirstMock.mockRejectedValueOnce(unsafeError);

    const response = await PATCH(
      createRequest({
        result: 'unchanged',
      }),
      { params: Promise.resolve({ id: 'inquiry_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(500);
    expectNoStore(response);
    const bodyText = await response.text();
    expect(bodyText).toContain('INTERNAL_ERROR');
    expect(bodyText).not.toContain('raw patient inquiry secret');
    expect(loggerErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'inquiry_record_patch_unhandled_error',
        route: '/api/inquiry-records/[id]',
        method: 'PATCH',
        status: 500,
      }),
      unsafeError,
    );
    const [logContext, logError] = loggerErrorMock.mock.calls[0] ?? [];
    expect(logError).toBe(unsafeError);
    expect(logContext).not.toHaveProperty('error_name');
    const logContextText = JSON.stringify(logContext);
    expect(logContextText).not.toContain('raw patient inquiry secret');
    expect(logContextText).not.toContain('InquiryPatientSecretError');
  });

  it('updates the linked prescription line when confirming a changed inquiry', async () => {
    inquiryRecordFindFirstMock.mockResolvedValue({
      id: 'inquiry_1',
      cycle_id: 'cycle_1',
      line_id: 'line_1',
      issue_id: 'issue_1',
      result: 'pending',
      updated_at: new Date('2026-01-01T00:00:00.000Z'),
      cycle: { overall_status: 'inquiry_pending' },
    });

    const lineUpdateMock = vi.fn().mockResolvedValue({ count: 1 });
    const inquiryUpdateMock = vi.fn().mockResolvedValue({ count: 1 });
    const inquiryFindUniqueMock = vi.fn().mockResolvedValue({
      id: 'inquiry_1',
      result: 'changed',
      change_detail: '1日2回へ変更',
    });
    const inquiryCountMock = vi.fn().mockResolvedValue(0);
    const cycleUpdateMock = vi.fn().mockResolvedValue({});
    const cycleTransitionLogCreateMock = vi.fn().mockResolvedValue({ id: 'transition_1' });
    const auditLogCreateMock = vi.fn().mockResolvedValue({ id: 'audit_1' });
    const txLineFindFirstMock = vi.fn().mockResolvedValue({
      id: 'line_1',
      drug_name: 'アムロジピン錠5mg',
      drug_code: 'YJ123',
      dose: '1錠',
      frequency: '1日1回',
      days: 7,
      packaging_instructions: null,
      route: 'internal',
      updated_at: new Date('2026-01-01T00:00:00.000Z'),
    });

    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        prescriptionLine: {
          findFirst: txLineFindFirstMock,
          updateMany: lineUpdateMock,
        },
        inquiryRecord: {
          updateMany: inquiryUpdateMock,
          findUnique: inquiryFindUniqueMock,
          count: inquiryCountMock,
        },
        medicationCycle: {
          update: cycleUpdateMock,
        },
        communicationRequest: {
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
        medicationIssue: {
          update: vi.fn().mockResolvedValue({}),
        },
        cycleTransitionLog: {
          create: cycleTransitionLogCreateMock,
        },
        auditLog: {
          create: auditLogCreateMock,
        },
      }),
    );

    const response = await PATCH(
      createRequest({
        result: 'changed',
        change_detail: '1日2回へ変更',
        line_update: {
          drug_name: 'アムロジピン錠5mg',
          dose: '1錠',
          frequency: '1日2回',
          days: 14,
        },
      }),
      { params: Promise.resolve({ id: 'inquiry_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expectNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({
      data: {
        id: 'inquiry_1',
        result: 'changed',
        change_detail: '1日2回へ変更',
      },
    });
    expect(body).not.toHaveProperty('id');
    expect(body).not.toHaveProperty('result');
    expect(body).not.toHaveProperty('change_detail');
    expect(withOrgContextMock).toHaveBeenCalledWith(
      'org_1',
      expect.any(Function),
      expect.objectContaining({
        requestContext: expect.objectContaining({
          orgId: 'org_1',
          userId: 'user_1',
          role: 'pharmacist',
        }),
      }),
    );
    expect(txLineFindFirstMock).toHaveBeenCalledWith({
      where: {
        id: 'line_1',
        org_id: 'org_1',
        intake: {
          cycle_id: 'cycle_1',
        },
      },
      select: {
        id: true,
        drug_name: true,
        drug_code: true,
        dose: true,
        frequency: true,
        days: true,
        packaging_instructions: true,
        route: true,
        updated_at: true,
      },
    });
    expect(lineUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'line_1',
          org_id: 'org_1',
          updated_at: new Date('2026-01-01T00:00:00.000Z'),
          intake: {
            cycle_id: 'cycle_1',
          },
        },
        data: expect.objectContaining({
          frequency: '1日2回',
          days: 14,
        }),
      }),
    );
    expect(cycleUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { overall_status: 'inquiry_resolved' },
      }),
    );
    expect(cycleTransitionLogCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        cycle_id: 'cycle_1',
        from_status: 'inquiry_pending',
        to_status: 'inquiry_resolved',
        actor_id: 'user_1',
        note: 'inquiry_record_resolved:inquiry_1',
      }),
    });
    expect(auditLogCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'inquiry_record_updated',
        target_type: 'inquiry_record',
        target_id: 'inquiry_1',
        changes: expect.objectContaining({
          result_before: 'pending',
          result_after: 'changed',
          line_id: 'line_1',
          cycle_status_before: 'inquiry_pending',
          cycle_status_after: 'inquiry_resolved',
          line_update: expect.objectContaining({
            frequency: { changed: true },
            days: { changed: true },
          }),
          change_detail_changed: true,
        }),
      }),
    });
    expect(JSON.stringify(auditLogCreateMock.mock.calls)).not.toContain('1日2回へ変更');
    expect(JSON.stringify(auditLogCreateMock.mock.calls)).not.toContain('1日1回');
    expect(JSON.stringify(auditLogCreateMock.mock.calls)).not.toContain('14');
    expect(auditLogCreateMock.mock.calls[0][0].data.changes.line_update).not.toHaveProperty(
      'drug_name',
    );
    expect(auditLogCreateMock.mock.calls[0][0].data.changes.line_update).not.toHaveProperty('dose');
    expect(notifyWorkflowMutationMock).toHaveBeenCalledWith({
      orgId: 'org_1',
      payload: {
        source: 'inquiry_records_update',
        inquiry_id: 'inquiry_1',
        cycle_id: 'cycle_1',
        result: 'changed',
        line_update_requested: true,
        line_linked: true,
        issue_linked: true,
      },
    });
    expect(JSON.stringify(notifyWorkflowMutationMock.mock.calls)).not.toContain('1日2回');
    expect(resolveOperationalTasksMock).toHaveBeenCalled();
  });

  it('clears inquiry resolution metadata when reopening a finalized linked inquiry', async () => {
    inquiryRecordFindFirstMock.mockResolvedValue({
      id: 'inquiry_1',
      cycle_id: 'cycle_1',
      line_id: null,
      issue_id: 'issue_1',
      result: 'changed',
      updated_at: new Date('2026-01-01T00:00:00.000Z'),
      cycle: { overall_status: 'inquiry_resolved' },
    });

    const inquiryUpdateMock = vi.fn().mockResolvedValue({ count: 1 });
    const inquiryFindUniqueMock = vi.fn().mockResolvedValue({
      id: 'inquiry_1',
      result: 'pending',
      resolved_at: null,
    });
    const cycleUpdateMock = vi.fn().mockResolvedValue({});
    const cycleTransitionLogCreateMock = vi.fn().mockResolvedValue({ id: 'transition_1' });
    const medicationIssueUpdateMock = vi.fn().mockResolvedValue({});
    const auditLogCreateMock = vi.fn().mockResolvedValue({ id: 'audit_1' });

    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        prescriptionLine: {
          findFirst: vi.fn(),
          updateMany: vi.fn(),
        },
        inquiryRecord: {
          updateMany: inquiryUpdateMock,
          findUnique: inquiryFindUniqueMock,
          count: vi.fn(),
        },
        medicationCycle: {
          update: cycleUpdateMock,
        },
        communicationRequest: {
          updateMany: vi.fn(),
        },
        medicationIssue: {
          update: medicationIssueUpdateMock,
        },
        cycleTransitionLog: {
          create: cycleTransitionLogCreateMock,
        },
        auditLog: {
          create: auditLogCreateMock,
        },
      }),
    );

    const response = await PATCH(
      createRequest({
        result: 'pending',
        change_detail: '再照会が必要',
      }),
      { params: Promise.resolve({ id: 'inquiry_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expectNoStore(response);
    expect(inquiryUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          result: 'pending',
          change_detail: '再照会が必要',
          resolved_at: null,
        }),
      }),
    );
    expect(cycleUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { overall_status: 'inquiry_pending' },
      }),
    );
    expect(cycleTransitionLogCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        from_status: 'inquiry_resolved',
        to_status: 'inquiry_pending',
        note: 'inquiry_record_reopened:inquiry_1',
      }),
    });
    expect(medicationIssueUpdateMock).toHaveBeenCalledWith({
      where: { id: 'issue_1' },
      data: {
        status: 'in_progress',
        resolved_by: null,
        resolved_at: null,
      },
    });
    expect(auditLogCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        changes: expect.objectContaining({
          result_before: 'changed',
          result_after: 'pending',
          change_detail_changed: true,
          cycle_status_after: 'inquiry_pending',
        }),
      }),
    });
    expect(notifyWorkflowMutationMock).toHaveBeenCalledWith({
      orgId: 'org_1',
      payload: {
        source: 'inquiry_records_update',
        inquiry_id: 'inquiry_1',
        cycle_id: 'cycle_1',
        result: 'pending',
        line_update_requested: false,
        line_linked: false,
        issue_linked: true,
      },
    });
    expect(JSON.stringify(auditLogCreateMock.mock.calls)).not.toContain('再照会が必要');
    expect(JSON.stringify(notifyWorkflowMutationMock.mock.calls)).not.toContain('再照会が必要');
  });

  it('denies stale line ownership before updating prescription lines', async () => {
    inquiryRecordFindFirstMock.mockResolvedValue({
      id: 'inquiry_1',
      cycle_id: 'cycle_1',
      line_id: 'line_foreign',
      issue_id: 'issue_1',
      result: 'pending',
    });
    const txLineFindFirstMock = vi.fn().mockResolvedValue(null);
    const lineUpdateMock = vi.fn().mockResolvedValue({ count: 1 });
    const auditLogCreateMock = vi.fn().mockResolvedValue({ id: 'audit_1' });

    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        prescriptionLine: {
          findFirst: txLineFindFirstMock,
          updateMany: lineUpdateMock,
        },
        inquiryRecord: {
          update: vi.fn().mockResolvedValue({}),
          count: vi.fn().mockResolvedValue(0),
        },
        medicationCycle: {
          update: vi.fn().mockResolvedValue({}),
        },
        communicationRequest: {
          updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        },
        medicationIssue: {
          update: vi.fn().mockResolvedValue({}),
        },
        cycleTransitionLog: {
          create: vi.fn().mockResolvedValue({}),
        },
        auditLog: {
          create: auditLogCreateMock,
        },
      }),
    );

    const response = await PATCH(
      createRequest({
        result: 'changed',
        change_detail: '1日2回へ変更',
        line_update: {
          frequency: '1日2回',
        },
      }),
      { params: Promise.resolve({ id: 'inquiry_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expect(txLineFindFirstMock).toHaveBeenCalledWith({
      where: {
        id: 'line_foreign',
        org_id: 'org_1',
        intake: {
          cycle_id: 'cycle_1',
        },
      },
      select: {
        id: true,
        drug_name: true,
        drug_code: true,
        dose: true,
        frequency: true,
        days: true,
        packaging_instructions: true,
        route: true,
        updated_at: true,
      },
    });
    expect(withOrgContextMock).toHaveBeenCalled();
    expect(prescriptionLineFindFirstMock).not.toHaveBeenCalled();
    expect(lineUpdateMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('rejects line updates unless the inquiry result is changed', async () => {
    inquiryRecordFindFirstMock.mockResolvedValue({
      id: 'inquiry_1',
      cycle_id: 'cycle_1',
      line_id: 'line_1',
      issue_id: 'issue_1',
      result: 'pending',
      updated_at: new Date('2026-01-01T00:00:00.000Z'),
      cycle: { overall_status: 'inquiry_pending' },
    });

    const response = await PATCH(
      createRequest({
        result: 'unchanged',
        line_update: {
          frequency: '1日2回',
        },
      }),
      { params: Promise.resolve({ id: 'inquiry_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '処方明細の更新内容は変更ありの場合のみ指定できます',
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
  });

  it('rejects empty line updates before loading the inquiry record', async () => {
    const response = await PATCH(
      createRequest({
        result: 'changed',
        line_update: {},
      }),
      { params: Promise.resolve({ id: 'inquiry_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expectNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '処方明細の更新内容が空です',
    });
    expectNoInquiryPatchSideEffects();
  });

  it('rejects line updates for inquiries that are not linked to a prescription line', async () => {
    inquiryRecordFindFirstMock.mockResolvedValue({
      id: 'inquiry_1',
      cycle_id: 'cycle_1',
      line_id: null,
      issue_id: 'issue_1',
      result: 'pending',
      cycle: { overall_status: 'inquiry_pending' },
    });

    const response = await PATCH(
      createRequest({
        result: 'changed',
        line_update: {
          frequency: '1日2回',
        },
      }),
      { params: Promise.resolve({ id: 'inquiry_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '処方明細の更新内容は明細に紐づく疑義照会でのみ指定できます',
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
  });

  it('rejects changed confirmations when the line update has no effective diff', async () => {
    inquiryRecordFindFirstMock.mockResolvedValue({
      id: 'inquiry_1',
      cycle_id: 'cycle_1',
      line_id: 'line_1',
      issue_id: 'issue_1',
      result: 'pending',
      updated_at: new Date('2026-01-01T00:00:00.000Z'),
      cycle: { overall_status: 'inquiry_pending' },
    });

    const txLineFindFirstMock = vi.fn().mockResolvedValue({
      id: 'line_1',
      drug_name: 'アムロジピン錠5mg',
      drug_code: 'YJ123',
      dose: '1錠',
      frequency: '1日1回',
      days: 7,
      packaging_instructions: null,
      route: 'internal',
      updated_at: new Date('2026-01-01T00:00:00.000Z'),
    });
    const lineUpdateMock = vi.fn().mockResolvedValue({ count: 1 });
    const inquiryUpdateMock = vi.fn().mockResolvedValue({ count: 1 });
    const cycleUpdateMock = vi.fn().mockResolvedValue({});
    const auditLogCreateMock = vi.fn().mockResolvedValue({});

    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        prescriptionLine: {
          findFirst: txLineFindFirstMock,
          updateMany: lineUpdateMock,
        },
        inquiryRecord: {
          updateMany: inquiryUpdateMock,
          findUnique: vi.fn(),
          count: vi.fn(),
        },
        medicationCycle: {
          update: cycleUpdateMock,
        },
        communicationRequest: {
          updateMany: vi.fn(),
        },
        medicationIssue: {
          update: vi.fn(),
        },
        cycleTransitionLog: {
          create: vi.fn(),
        },
        auditLog: {
          create: auditLogCreateMock,
        },
      }),
    );

    const response = await PATCH(
      createRequest({
        result: 'changed',
        change_detail: '変更あり',
        line_update: {
          frequency: '1日1回',
        },
      }),
      { params: Promise.resolve({ id: 'inquiry_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expectNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '処方明細の更新内容に変更がありません',
    });
    expect(txLineFindFirstMock).toHaveBeenCalled();
    expect(lineUpdateMock).not.toHaveBeenCalled();
    expect(inquiryUpdateMock).not.toHaveBeenCalled();
    expect(cycleUpdateMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
    expect(resolveOperationalTasksMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('returns conflict when the prescription line changes before the guarded update', async () => {
    inquiryRecordFindFirstMock.mockResolvedValue({
      id: 'inquiry_1',
      cycle_id: 'cycle_1',
      line_id: 'line_1',
      issue_id: 'issue_1',
      result: 'pending',
      cycle: { overall_status: 'inquiry_pending' },
    });

    const txLineFindFirstMock = vi.fn().mockResolvedValue({
      id: 'line_1',
      drug_name: 'アムロジピン錠5mg',
      drug_code: 'YJ123',
      dose: '1錠',
      frequency: '1日1回',
      days: 7,
      packaging_instructions: null,
      route: 'internal',
      updated_at: new Date('2026-01-01T00:00:00.000Z'),
    });
    const lineUpdateMock = vi.fn().mockResolvedValue({ count: 0 });
    const inquiryUpdateMock = vi.fn().mockResolvedValue({ count: 1 });
    const auditLogCreateMock = vi.fn().mockResolvedValue({});

    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        prescriptionLine: {
          findFirst: txLineFindFirstMock,
          updateMany: lineUpdateMock,
        },
        inquiryRecord: {
          updateMany: inquiryUpdateMock,
          findUnique: vi.fn().mockResolvedValue({ id: 'inquiry_1' }),
          count: vi.fn().mockResolvedValue(0),
        },
        medicationCycle: {
          update: vi.fn().mockResolvedValue({}),
        },
        communicationRequest: {
          updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        },
        medicationIssue: {
          update: vi.fn().mockResolvedValue({}),
        },
        cycleTransitionLog: {
          create: vi.fn().mockResolvedValue({}),
        },
        auditLog: {
          create: auditLogCreateMock,
        },
      }),
    );

    const response = await PATCH(
      createRequest({
        result: 'changed',
        change_detail: '1日2回へ変更',
        line_update: {
          frequency: '1日2回',
        },
      }),
      { params: Promise.resolve({ id: 'inquiry_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      message: '処方明細が他のユーザーによって更新されています。最新のデータを取得してください。',
    });
    expect(lineUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'line_1',
          updated_at: new Date('2026-01-01T00:00:00.000Z'),
        }),
      }),
    );
    expect(inquiryUpdateMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('returns conflict before side effects when the inquiry record changed after loading', async () => {
    inquiryRecordFindFirstMock.mockResolvedValue({
      id: 'inquiry_1',
      cycle_id: 'cycle_1',
      line_id: null,
      issue_id: 'issue_1',
      result: 'pending',
      updated_at: new Date('2026-01-01T00:00:00.000Z'),
      cycle: { overall_status: 'inquiry_pending' },
    });

    const inquiryUpdateMock = vi.fn().mockResolvedValue({ count: 0 });
    const cycleUpdateMock = vi.fn().mockResolvedValue({});
    const auditLogCreateMock = vi.fn().mockResolvedValue({});

    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        prescriptionLine: {
          findFirst: vi.fn().mockResolvedValue(null),
          updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        },
        inquiryRecord: {
          updateMany: inquiryUpdateMock,
          findUnique: vi.fn().mockResolvedValue({ id: 'inquiry_1' }),
          count: vi.fn().mockResolvedValue(0),
        },
        medicationCycle: {
          update: cycleUpdateMock,
        },
        communicationRequest: {
          updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        },
        medicationIssue: {
          update: vi.fn().mockResolvedValue({}),
        },
        cycleTransitionLog: {
          create: vi.fn().mockResolvedValue({}),
        },
        auditLog: {
          create: auditLogCreateMock,
        },
      }),
    );

    const response = await PATCH(
      createRequest({
        result: 'unchanged',
        change_detail: '変更なし',
      }),
      { params: Promise.resolve({ id: 'inquiry_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      message:
        '疑義照会記録が他のユーザーによって更新されています。最新のデータを取得してください。',
    });
    expect(inquiryUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'inquiry_1',
          updated_at: new Date('2026-01-01T00:00:00.000Z'),
        }),
      }),
    );
    expect(cycleUpdateMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('persists structured inquiry fields when provided', async () => {
    inquiryRecordFindFirstMock.mockResolvedValue({
      id: 'inquiry_1',
      cycle_id: 'cycle_1',
      line_id: null,
      issue_id: null,
      result: 'pending',
      updated_at: new Date('2026-01-01T00:00:00.000Z'),
      cycle: { overall_status: 'inquiry_pending' },
    });

    const inquiryUpdateMock = vi.fn().mockResolvedValue({ count: 1 });
    const inquiryFindUniqueMock = vi.fn().mockResolvedValue({
      id: 'inquiry_1',
      result: 'unchanged',
      proposal_origin: 'pre_issuance',
      residual_adjustment: true,
    });

    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        prescriptionLine: {
          update: vi.fn().mockResolvedValue({}),
        },
        inquiryRecord: {
          updateMany: inquiryUpdateMock,
          findUnique: inquiryFindUniqueMock,
          count: vi.fn().mockResolvedValue(0),
        },
        medicationCycle: {
          update: vi.fn().mockResolvedValue({}),
        },
        communicationRequest: {
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
        medicationIssue: {
          update: vi.fn().mockResolvedValue({}),
        },
        cycleTransitionLog: {
          create: vi.fn().mockResolvedValue({}),
        },
        auditLog: {
          create: vi.fn().mockResolvedValue({}),
        },
      }),
    );

    const response = await PATCH(
      createRequest({
        result: 'unchanged',
        proposal_origin: 'pre_issuance',
        residual_adjustment: true,
      }),
      { params: Promise.resolve({ id: 'inquiry_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(inquiryUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          proposal_origin: 'pre_issuance',
          residual_adjustment: true,
        }),
      }),
    );
  });

  it('keeps the cycle in inquiry_pending when other unresolved inquiries remain', async () => {
    inquiryRecordFindFirstMock.mockResolvedValue({
      id: 'inquiry_1',
      cycle_id: 'cycle_1',
      line_id: null,
      issue_id: 'issue_1',
      result: 'pending',
      updated_at: new Date('2026-01-01T00:00:00.000Z'),
      cycle: { overall_status: 'inquiry_pending' },
    });

    const cycleUpdateMock = vi.fn().mockResolvedValue({});
    const cycleTransitionLogCreateMock = vi.fn().mockResolvedValue({ id: 'transition_1' });

    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        prescriptionLine: {
          update: vi.fn().mockResolvedValue({}),
        },
        inquiryRecord: {
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
          findUnique: vi.fn().mockResolvedValue({
            id: 'inquiry_1',
            result: 'unchanged',
          }),
          count: vi.fn().mockResolvedValue(1),
        },
        medicationCycle: {
          update: cycleUpdateMock,
        },
        communicationRequest: {
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
        medicationIssue: {
          update: vi.fn().mockResolvedValue({}),
        },
        cycleTransitionLog: {
          create: cycleTransitionLogCreateMock,
        },
        auditLog: {
          create: vi.fn().mockResolvedValue({}),
        },
      }),
    );

    const response = await PATCH(
      createRequest({
        result: 'unchanged',
        change_detail: '変更なし',
      }),
      { params: Promise.resolve({ id: 'inquiry_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(cycleUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { overall_status: 'inquiry_pending' },
      }),
    );
    expect(cycleTransitionLogCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        cycle_id: 'cycle_1',
        from_status: 'inquiry_pending',
        to_status: 'inquiry_pending',
        actor_id: 'user_1',
      }),
    });
  });

  it('rejects changed confirmations without a line update for line-specific inquiries', async () => {
    inquiryRecordFindFirstMock.mockResolvedValue({
      id: 'inquiry_1',
      cycle_id: 'cycle_1',
      line_id: 'line_1',
      issue_id: 'issue_1',
      result: 'pending',
    });

    const response = await PATCH(
      createRequest({
        result: 'changed',
        change_detail: '変更あり',
      }),
      { params: Promise.resolve({ id: 'inquiry_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '変更ありで確定する場合は処方明細の更新内容が必要です',
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
  });
});
