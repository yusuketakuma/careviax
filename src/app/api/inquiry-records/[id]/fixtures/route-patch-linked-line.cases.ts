import { expect, it, vi } from 'vitest';
import { expectNoStore } from '@/test/api-response-assertions';
import { getInquiryRecordPatchTestSupport } from '../route.test-support';
import { PATCH } from '../route';

const {
  withOrgContextMock,
  inquiryRecordFindFirstMock,
  prescriptionLineFindFirstMock,
  resolveOperationalTasksMock,
  notifyWorkflowMutationMock,
  createRequest,
} = getInquiryRecordPatchTestSupport();

export function registerInquiryRecordPatchLinkedLineCases() {
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
        version: { increment: 1 },
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
    expectNoStore(response);
    await expect(response.json()).resolves.toEqual({
      code: 'VALIDATION_ERROR',
      message: '入力値が不正です',
      details: {
        line_update: ['更新対象の処方明細を確認できません'],
      },
    });
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
    expect(resolveOperationalTasksMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });
}
