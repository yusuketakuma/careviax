import { expect, it, vi } from 'vitest';
import { expectNoStore } from '@/test/api-response-assertions';
import { getInquiryRecordPatchTestSupport } from '../route.test-support';
import { PATCH } from '../route';

const {
  requireAuthContextMock,
  withAuthContextOptions,
  withOrgContextMock,
  inquiryRecordFindFirstMock,
  prescriptionLineFindFirstMock,
  resolveOperationalTasksMock,
  notifyWorkflowMutationMock,
  loggerErrorMock,
  createRequest,
  createMalformedJsonRequest,
  expectNoInquiryPatchSideEffects,
} = getInquiryRecordPatchTestSupport();

export function registerInquiryRecordPatchCoreCases() {
  it('registers the dynamic PATCH wrapper with the exact visit permission contract', () => {
    expect(withAuthContextOptions).toEqual([
      {
        permission: 'canVisit',
        message: '問い合わせ記録の更新権限がありません',
      },
    ]);
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
    expectNoStore(response);
    await expect(response.json()).resolves.toEqual({
      code: 'WORKFLOW_NOT_FOUND',
      message: '疑義照会記録が見つかりません',
    });
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

  it('leaves unexpected inquiry lookup errors to the shared wrapper boundary', async () => {
    const unsafeError = new Error('raw patient inquiry secret');
    unsafeError.name = 'InquiryPatientSecretError';
    inquiryRecordFindFirstMock.mockRejectedValueOnce(unsafeError);

    await expect(
      PATCH(
        createRequest({
          result: 'unchanged',
        }),
        { params: Promise.resolve({ id: 'inquiry_1' }) },
      ),
    ).rejects.toBe(unsafeError);
    expect(loggerErrorMock).not.toHaveBeenCalled();
  });
}
