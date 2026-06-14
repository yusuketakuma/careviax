import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  requireAuthContextMock,
  withOrgContextMock,
  inquiryRecordFindFirstMock,
  prescriptionLineFindFirstMock,
  resolveOperationalTasksMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  inquiryRecordFindFirstMock: vi.fn(),
  prescriptionLineFindFirstMock: vi.fn(),
  resolveOperationalTasksMock: vi.fn(),
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

  it('rejects non-object patch payloads before loading the inquiry record', async () => {
    const response = await PATCH(createRequest([]), {
      params: Promise.resolve({ id: 'inquiry_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
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
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '疑義照会記録IDが不正です',
    });
    expect(inquiryRecordFindFirstMock).not.toHaveBeenCalled();
    expect(prescriptionLineFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(resolveOperationalTasksMock).not.toHaveBeenCalled();
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
            frequency: { before: '1日1回', after: '1日2回' },
            days: { before: 7, after: 14 },
          }),
        }),
      }),
    });
    expect(auditLogCreateMock.mock.calls[0][0].data.changes.line_update).not.toHaveProperty(
      'drug_name',
    );
    expect(auditLogCreateMock.mock.calls[0][0].data.changes.line_update).not.toHaveProperty('dose');
    expect(resolveOperationalTasksMock).toHaveBeenCalled();
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
