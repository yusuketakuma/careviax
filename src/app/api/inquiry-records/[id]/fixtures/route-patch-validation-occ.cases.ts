import { expect, it, vi } from 'vitest';
import { expectNoStore } from '@/test/api-response-assertions';
import { getInquiryRecordPatchTestSupport } from '../route.test-support';
import { PATCH } from '../route';

const {
  withOrgContextMock,
  inquiryRecordFindFirstMock,
  resolveOperationalTasksMock,
  notifyWorkflowMutationMock,
  createRequest,
  expectNoInquiryPatchSideEffects,
} = getInquiryRecordPatchTestSupport();

export function registerInquiryRecordPatchValidationOccCases() {
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
}
