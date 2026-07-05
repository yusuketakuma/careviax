import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  extractHandoffFromSoapMock,
  withOrgContextMock,
  upsertOperationalTaskMock,
  resolveOperationalTasksMock,
  createAuditLogEntryMock,
} = vi.hoisted(() => ({
  extractHandoffFromSoapMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  upsertOperationalTaskMock: vi.fn(),
  resolveOperationalTasksMock: vi.fn(),
  createAuditLogEntryMock: vi.fn(),
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {},
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('./visit-brief-ai', () => ({
  extractHandoffFromSoap: extractHandoffFromSoapMock,
}));

vi.mock('./operational-tasks', () => ({
  upsertOperationalTask: upsertOperationalTaskMock,
  resolveOperationalTasks: resolveOperationalTasksMock,
}));

vi.mock('@/lib/audit/audit-entry', () => ({
  createAuditLogEntry: createAuditLogEntryMock,
}));

import {
  processHandoffExtraction,
  confirmHandoff,
  normalizeStructuredSoapForVisitRecordSave,
  VisitHandoffInvalidDataError,
  VisitHandoffAlreadyConfirmedError,
  VisitHandoffMissingDataError,
  VisitHandoffSupervisionTaskUnavailableError,
  VISIT_HANDOFF_EXTRACTION_FAILED_MESSAGE,
  requestHandoffConfirmationSupervision,
} from './visit-handoff';
import type { StructuredSoap } from '@/types/structured-soap';

const baseSoap: StructuredSoap = {
  subjective: { symptom_checks: [] },
  objective: { medication_status: 'full_compliance', adherence_score: 3, side_effect_checks: [] },
  assessment: { problem_checks: [] },
  plan: { intervention_checks: [] },
};

describe('normalizeStructuredSoapForVisitRecordSave', () => {
  it('removes server-managed handoff metadata from ordinary visit record saves', () => {
    const normalized = normalizeStructuredSoapForVisitRecordSave({
      ...baseSoap,
      handoff: {
        next_check_items: ['眠気確認'],
        ongoing_monitoring: ['血圧'],
        decision_rationale: '患者入力の根拠',
        ai_extracted: true,
        ai_confidence: 0.91,
        confirmed_by: 'attacker',
        confirmed_at: '2026-04-01T00:00:00.000Z',
        extracted_at: '2026-04-01T00:00:00.000Z',
      },
    });

    expect(normalized).toMatchObject({
      handoff: {
        next_check_items: ['眠気確認'],
        ongoing_monitoring: ['血圧'],
        decision_rationale: '患者入力の根拠',
        ai_extracted: false,
        ai_confidence: null,
        confirmed_by: null,
        confirmed_at: null,
        extracted_at: null,
      },
    });
  });

  it('preserves the existing server-owned handoff over an ordinary structured SOAP patch', () => {
    const existingHandoff = {
      next_check_items: ['既存の確認事項'],
      ongoing_monitoring: ['既存の観察'],
      decision_rationale: '確認済みの根拠',
      ai_extracted: true,
      ai_confidence: 0.81,
      confirmed_by: 'pharmacist-1',
      confirmed_at: '2026-04-02T00:00:00.000Z',
      extracted_at: '2026-04-01T00:00:00.000Z',
    };

    const normalized = normalizeStructuredSoapForVisitRecordSave(
      {
        ...baseSoap,
        handoff: {
          next_check_items: ['上書き要求'],
          ongoing_monitoring: [],
          decision_rationale: '上書き根拠',
          ai_extracted: true,
          ai_confidence: 1,
          confirmed_by: 'attacker',
          confirmed_at: '2026-04-03T00:00:00.000Z',
          extracted_at: '2026-04-03T00:00:00.000Z',
        },
      },
      {
        ...baseSoap,
        handoff: existingHandoff,
      },
    );

    expect(normalized).toMatchObject({
      handoff: existingHandoff,
    });
  });
});

describe('processHandoffExtraction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('extracts handoff from SOAP and stores it via withOrgContext', async () => {
    const extractedHandoff = {
      next_check_items: ['血圧確認'],
      ongoing_monitoring: ['残薬管理'],
      decision_rationale: '急変リスクあり',
      confidence: 0.85,
      extracted_at: '2026-04-01T00:00:00Z',
    };
    extractHandoffFromSoapMock.mockResolvedValue(extractedHandoff);

    const visitRecordFindUniqueOrThrowMock = vi.fn().mockResolvedValue({
      structured_soap: baseSoap,
      schedule_id: 'schedule-1',
      version: 2,
      updated_at: new Date('2026-04-01T01:00:00Z'),
    });
    const visitRecordUpdateManyMock = vi.fn().mockResolvedValue({ count: 1 });
    const visitHandoffExtractionUpsertMock = vi.fn().mockResolvedValue({});
    upsertOperationalTaskMock.mockResolvedValue({ id: 'task-1' });

    withOrgContextMock.mockImplementation(
      async (_orgId: string, fn: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          visitRecord: {
            findUniqueOrThrow: visitRecordFindUniqueOrThrowMock,
            updateMany: visitRecordUpdateManyMock,
          },
          visitHandoffExtraction: {
            upsert: visitHandoffExtractionUpsertMock,
          },
        };
        return fn(tx);
      },
    );

    const db = {} as Parameters<typeof processHandoffExtraction>[0];
    const result = await processHandoffExtraction(db, {
      orgId: 'org-1',
      visitRecordId: 'vr-1',
      patientId: 'p-1',
      patientName: '田中太郎',
      structuredSoap: baseSoap,
      soapAssessment: '状態安定',
      soapPlan: '継続処方',
      handoffConfirmationAssigneeId: 'user-1',
    });

    expect(extractHandoffFromSoapMock).toHaveBeenCalledOnce();
    expect(result.next_check_items).toEqual(['血圧確認']);
    expect(result.ai_extracted).toBe(true);
    expect(result.ai_confidence).toBe(0.85);
    expect(visitRecordUpdateManyMock).toHaveBeenCalledWith({
      where: { id: 'vr-1', version: 2 },
      data: {
        structured_soap: expect.objectContaining({
          ...baseSoap,
          handoff: expect.objectContaining({
            next_check_items: ['血圧確認'],
            ongoing_monitoring: ['残薬管理'],
            decision_rationale: '急変リスクあり',
            ai_extracted: true,
            ai_confidence: 0.85,
            confirmed_by: null,
            confirmed_at: null,
            extracted_at: '2026-04-01T00:00:00Z',
          }),
        }),
      },
    });
    expect(visitHandoffExtractionUpsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          visit_record_id: 'vr-1',
          schedule_id: 'schedule-1',
          source_visit_record_version: 2,
          source_visit_record_updated_at: new Date('2026-04-01T01:00:00Z'),
          status: 'extracting',
          retry_count: 0,
          retryable: false,
        }),
      }),
    );
    expect(visitHandoffExtractionUpsertMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          status: 'succeeded',
          retryable: false,
        }),
      }),
    );

    // Verify the task was upserted
    expect(upsertOperationalTaskMock).toHaveBeenCalledOnce();
    const taskCall = upsertOperationalTaskMock.mock.calls[0][1];
    expect(taskCall.taskType).toBe('handoff_confirmation');
    expect(taskCall.assignedTo).toBe('user-1');
    expect(taskCall.dedupeKey).toBe('handoff_confirm_vr-1');
  });

  it('rebuilds structured SOAP from an empty object when the persisted SOAP root is malformed', async () => {
    const extractedHandoff = {
      next_check_items: ['血圧確認'],
      ongoing_monitoring: ['残薬管理'],
      decision_rationale: '急変リスクあり',
      confidence: 0.85,
      extracted_at: '2026-04-01T00:00:00Z',
    };
    extractHandoffFromSoapMock.mockResolvedValue(extractedHandoff);

    const visitRecordFindUniqueOrThrowMock = vi.fn().mockResolvedValue({
      structured_soap: ['unexpected'],
      schedule_id: 'schedule-1',
      version: 2,
      updated_at: new Date('2026-04-01T01:00:00Z'),
    });
    const visitRecordUpdateManyMock = vi.fn().mockResolvedValue({ count: 1 });
    const visitHandoffExtractionUpsertMock = vi.fn().mockResolvedValue({});
    upsertOperationalTaskMock.mockResolvedValue({ id: 'task-1' });

    withOrgContextMock.mockImplementation(
      async (_orgId: string, fn: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          visitRecord: {
            findUniqueOrThrow: visitRecordFindUniqueOrThrowMock,
            updateMany: visitRecordUpdateManyMock,
          },
          visitHandoffExtraction: {
            upsert: visitHandoffExtractionUpsertMock,
          },
        };
        return fn(tx);
      },
    );

    const db = {} as Parameters<typeof processHandoffExtraction>[0];
    await processHandoffExtraction(db, {
      orgId: 'org-1',
      visitRecordId: 'vr-1',
      patientId: 'p-1',
      patientName: '田中太郎',
      structuredSoap: baseSoap,
      soapAssessment: '状態安定',
      soapPlan: '継続処方',
    });

    expect(visitRecordUpdateManyMock).toHaveBeenCalledWith({
      where: { id: 'vr-1', version: 2 },
      data: {
        structured_soap: expect.objectContaining({
          handoff: expect.objectContaining({
            next_check_items: ['血圧確認'],
          }),
        }),
      },
    });
    expect(visitHandoffExtractionUpsertMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          status: 'succeeded',
          retryable: false,
        }),
      }),
    );
  });

  it('persists a retryable failed extraction state without touching VisitRecord when AI extraction fails', async () => {
    extractHandoffFromSoapMock.mockRejectedValue(new Error('model timeout with patient SOAP text'));

    const visitRecordFindUniqueOrThrowMock = vi.fn().mockResolvedValue({
      structured_soap: baseSoap,
      schedule_id: 'schedule-1',
      version: 2,
      updated_at: new Date('2026-04-01T01:00:00Z'),
    });
    const visitRecordUpdateManyMock = vi.fn().mockResolvedValue({ count: 1 });
    const visitHandoffExtractionUpsertMock = vi.fn().mockResolvedValue({});

    withOrgContextMock.mockImplementation(
      async (_orgId: string, fn: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          visitRecord: {
            findUniqueOrThrow: visitRecordFindUniqueOrThrowMock,
            updateMany: visitRecordUpdateManyMock,
          },
          visitHandoffExtraction: {
            upsert: visitHandoffExtractionUpsertMock,
          },
        };
        return fn(tx);
      },
    );

    const db = {} as Parameters<typeof processHandoffExtraction>[0];
    await expect(
      processHandoffExtraction(db, {
        orgId: 'org-1',
        visitRecordId: 'vr-1',
        patientId: 'p-1',
        patientName: '田中太郎',
        structuredSoap: baseSoap,
        soapAssessment: '状態安定',
        soapPlan: '継続処方',
        expectedVersion: 2,
      }),
    ).rejects.toThrow('model timeout with patient SOAP text');

    expect(visitRecordUpdateManyMock).not.toHaveBeenCalled();
    expect(visitHandoffExtractionUpsertMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          status: 'failed',
          retry_count: { increment: 1 },
          error_message: VISIT_HANDOFF_EXTRACTION_FAILED_MESSAGE,
          retryable: true,
        }),
      }),
    );
    expect(visitHandoffExtractionUpsertMock).not.toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          error_message: 'model timeout with patient SOAP text',
        }),
      }),
    );
    expect(upsertOperationalTaskMock).not.toHaveBeenCalled();
  });

  it('persists a retryable failed state without touching VisitRecord when extraction has no clinical handoff content', async () => {
    extractHandoffFromSoapMock.mockResolvedValue({
      next_check_items: [],
      ongoing_monitoring: [],
      decision_rationale: null,
      confidence: 0.3,
      extracted_at: '2026-04-01T00:00:00Z',
    });

    const visitRecordFindUniqueOrThrowMock = vi.fn().mockResolvedValue({
      structured_soap: baseSoap,
      schedule_id: 'schedule-1',
      version: 2,
      updated_at: new Date('2026-04-01T01:00:00Z'),
    });
    const visitRecordUpdateManyMock = vi.fn();
    const visitHandoffExtractionUpsertMock = vi.fn().mockResolvedValue({});

    withOrgContextMock.mockImplementation(
      async (_orgId: string, fn: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          visitRecord: {
            findUniqueOrThrow: visitRecordFindUniqueOrThrowMock,
            updateMany: visitRecordUpdateManyMock,
          },
          visitHandoffExtraction: {
            upsert: visitHandoffExtractionUpsertMock,
          },
        };
        return fn(tx);
      },
    );

    const db = {} as Parameters<typeof processHandoffExtraction>[0];
    await expect(
      processHandoffExtraction(db, {
        orgId: 'org-1',
        visitRecordId: 'vr-1',
        patientId: 'p-1',
        patientName: '田中太郎',
        structuredSoap: baseSoap,
        soapAssessment: '状態安定',
        soapPlan: '',
        expectedVersion: 2,
      }),
    ).rejects.toBeInstanceOf(VisitHandoffInvalidDataError);

    expect(visitRecordUpdateManyMock).not.toHaveBeenCalled();
    expect(upsertOperationalTaskMock).not.toHaveBeenCalled();
    expect(visitHandoffExtractionUpsertMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          status: 'failed',
          retry_count: { increment: 1 },
          error_message: VISIT_HANDOFF_EXTRACTION_FAILED_MESSAGE,
          retryable: true,
        }),
      }),
    );
  });

  it('persists a generic retryable failed state when saving extracted handoff fails', async () => {
    extractHandoffFromSoapMock.mockResolvedValue({
      next_check_items: ['血圧確認'],
      ongoing_monitoring: ['残薬管理'],
      decision_rationale: '急変リスクあり',
      confidence: 0.85,
      extracted_at: '2026-04-01T00:00:00Z',
    });

    const visitRecordFindUniqueOrThrowMock = vi.fn().mockResolvedValue({
      structured_soap: baseSoap,
      schedule_id: 'schedule-1',
      version: 2,
      updated_at: new Date('2026-04-01T01:00:00Z'),
    });
    const visitRecordUpdateManyMock = vi
      .fn()
      .mockRejectedValue(new Error('patient=田中太郎 SOAP=服薬状況 token=secret'));
    const visitHandoffExtractionUpsertMock = vi.fn().mockResolvedValue({});

    withOrgContextMock.mockImplementation(
      async (_orgId: string, fn: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          visitRecord: {
            findUniqueOrThrow: visitRecordFindUniqueOrThrowMock,
            updateMany: visitRecordUpdateManyMock,
          },
          visitHandoffExtraction: {
            upsert: visitHandoffExtractionUpsertMock,
          },
        };
        return fn(tx);
      },
    );

    const db = {} as Parameters<typeof processHandoffExtraction>[0];
    await expect(
      processHandoffExtraction(db, {
        orgId: 'org-1',
        visitRecordId: 'vr-1',
        patientId: 'p-1',
        patientName: '田中太郎',
        structuredSoap: baseSoap,
        soapAssessment: '状態安定',
        soapPlan: '継続処方',
        expectedVersion: 2,
      }),
    ).rejects.toThrow('patient=田中太郎 SOAP=服薬状況 token=secret');

    expect(visitHandoffExtractionUpsertMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          status: 'failed',
          retry_count: { increment: 1 },
          error_message: VISIT_HANDOFF_EXTRACTION_FAILED_MESSAGE,
          retryable: true,
        }),
      }),
    );
    expect(visitHandoffExtractionUpsertMock).not.toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          error_message: 'patient=田中太郎 SOAP=服薬状況 token=secret',
        }),
      }),
    );
  });

  it('does not persist or enqueue confirmation when the visit record changed after extraction started', async () => {
    extractHandoffFromSoapMock.mockResolvedValue({
      next_check_items: ['血圧確認'],
      ongoing_monitoring: ['残薬管理'],
      decision_rationale: '急変リスクあり',
      confidence: 0.85,
      extracted_at: '2026-04-01T00:00:00Z',
    });

    const visitRecordFindUniqueOrThrowMock = vi.fn().mockResolvedValue({
      structured_soap: baseSoap,
      schedule_id: 'schedule-1',
      version: 3,
      updated_at: new Date('2026-04-01T01:00:00Z'),
    });
    const visitRecordUpdateManyMock = vi.fn().mockResolvedValue({ count: 0 });
    const visitHandoffExtractionUpsertMock = vi.fn().mockResolvedValue({});

    withOrgContextMock.mockImplementation(
      async (_orgId: string, fn: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          visitRecord: {
            findUniqueOrThrow: visitRecordFindUniqueOrThrowMock,
            updateMany: visitRecordUpdateManyMock,
          },
          visitHandoffExtraction: {
            upsert: visitHandoffExtractionUpsertMock,
          },
        };
        return fn(tx);
      },
    );

    const db = {} as Parameters<typeof processHandoffExtraction>[0];
    await expect(
      processHandoffExtraction(db, {
        orgId: 'org-1',
        visitRecordId: 'vr-1',
        patientId: 'p-1',
        patientName: '田中太郎',
        structuredSoap: baseSoap,
        soapAssessment: '状態安定',
        soapPlan: '継続処方',
        expectedVersion: 2,
      }),
    ).rejects.toThrow('changed before handoff extraction');

    expect(visitRecordUpdateManyMock).not.toHaveBeenCalled();
    expect(visitHandoffExtractionUpsertMock).not.toHaveBeenCalled();
    expect(upsertOperationalTaskMock).not.toHaveBeenCalled();
  });
});

describe('confirmHandoff', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('confirms existing handoff and resolves operational task', async () => {
    const existingHandoff = {
      next_check_items: ['血圧確認'],
      ongoing_monitoring: ['残薬管理'],
      decision_rationale: '急変リスクあり',
      ai_extracted: true,
      ai_confidence: 0.85,
      confirmed_by: null,
      confirmed_at: null,
      extracted_at: '2026-04-01T00:00:00Z',
    };

    const visitRecordFindUniqueOrThrowMock = vi.fn().mockResolvedValue({
      version: 2,
      structured_soap: { ...baseSoap, handoff: existingHandoff },
    });
    const visitRecordUpdateManyMock = vi.fn().mockResolvedValue({ count: 1 });
    resolveOperationalTasksMock.mockResolvedValue({ count: 1 });

    withOrgContextMock.mockImplementation(
      async (_orgId: string, fn: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          visitRecord: {
            findUniqueOrThrow: visitRecordFindUniqueOrThrowMock,
            updateMany: visitRecordUpdateManyMock,
          },
        };
        return fn(tx);
      },
    );

    const db = {} as Parameters<typeof confirmHandoff>[0];
    const result = await confirmHandoff(db, {
      orgId: 'org-1',
      visitRecordId: 'vr-1',
      confirmedBy: 'user-1',
      expectedVersion: 2,
    });

    expect(result.confirmed_by).toBe('user-1');
    expect(result.confirmed_at).toBeTruthy();
    expect(result.next_check_items).toEqual(['血圧確認']);
    expect(visitRecordUpdateManyMock).toHaveBeenCalledWith({
      where: { id: 'vr-1', version: 2 },
      data: {
        structured_soap: expect.objectContaining({
          ...baseSoap,
          handoff: expect.objectContaining({
            next_check_items: ['血圧確認'],
            ongoing_monitoring: ['残薬管理'],
            decision_rationale: '急変リスクあり',
            ai_extracted: true,
            ai_confidence: 0.85,
            confirmed_by: 'user-1',
            confirmed_at: expect.any(String),
            extracted_at: '2026-04-01T00:00:00Z',
          }),
        }),
        version: { increment: 1 },
      },
    });

    expect(resolveOperationalTasksMock).toHaveBeenCalledOnce();
    const resolveCall = resolveOperationalTasksMock.mock.calls[0][1];
    expect(resolveCall.dedupeKey).toBe('handoff_confirm_vr-1');
    expect(resolveCall.assignedToUserId).toBe('user-1');
    expect(resolveCall.includeUnassigned).toBe(true);
  });

  it('guards confirmation updates with assignment claim and writes PHI-free audit metadata', async () => {
    const existingHandoff = {
      next_check_items: ['血圧確認'],
      ongoing_monitoring: ['残薬管理'],
      decision_rationale: '急変リスクあり',
      ai_extracted: true,
      ai_confidence: 0.85,
      confirmed_by: null,
      confirmed_at: null,
      extracted_at: '2026-04-01T00:00:00Z',
    };

    const visitRecordFindUniqueOrThrowMock = vi.fn().mockResolvedValue({
      version: 2,
      schedule_id: 'schedule-1',
      structured_soap: { ...baseSoap, handoff: existingHandoff },
    });
    const visitRecordUpdateManyMock = vi.fn().mockResolvedValue({ count: 1 });
    resolveOperationalTasksMock.mockResolvedValue({ count: 1 });
    createAuditLogEntryMock.mockResolvedValue({ id: 'audit-1' });

    withOrgContextMock.mockImplementation(
      async (_orgId: string, fn: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          visitRecord: {
            findUniqueOrThrow: visitRecordFindUniqueOrThrowMock,
            updateMany: visitRecordUpdateManyMock,
          },
          auditLog: { create: vi.fn() },
        };
        return fn(tx);
      },
    );

    const db = {} as Parameters<typeof confirmHandoff>[0];
    await confirmHandoff(db, {
      orgId: 'org-1',
      visitRecordId: 'vr-1',
      confirmedBy: 'user-1',
      expectedVersion: 2,
      edits: {
        decision_rationale: '申し送り内容を確認済み',
      },
      requestContext: {
        orgId: 'org-1',
        userId: 'user-1',
        role: 'pharmacist',
        ipAddress: '127.0.0.1',
        userAgent: 'test',
      },
      confirmationWhere: {
        schedule: {
          OR: [{ pharmacist_id: 'user-1' }, { case_: { primary_pharmacist_id: 'user-1' } }],
        },
      },
      confirmationBasis: 'assigned_schedule',
    });

    expect(visitRecordUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [
            { id: 'vr-1', version: 2 },
            {
              schedule: {
                OR: [{ pharmacist_id: 'user-1' }, { case_: { primary_pharmacist_id: 'user-1' } }],
              },
            },
          ],
        },
      }),
    );
    expect(createAuditLogEntryMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ orgId: 'org-1', userId: 'user-1' }),
      expect.objectContaining({
        action: 'visit_handoff_confirmed',
        targetType: 'visit_record',
        targetId: 'vr-1',
        changes: expect.objectContaining({
          visit_record_id: 'vr-1',
          schedule_id: 'schedule-1',
          confirmed_by: 'user-1',
          authorized_basis: 'assigned_schedule',
          edited_fields: ['decision_rationale'],
          before: expect.objectContaining({
            next_check_items_count: 1,
            ongoing_monitoring_count: 1,
            decision_rationale_present: true,
          }),
          after: expect.objectContaining({
            next_check_items_count: 1,
            ongoing_monitoring_count: 1,
            decision_rationale_present: true,
          }),
        }),
      }),
    );
    const auditText = JSON.stringify(createAuditLogEntryMock.mock.calls);
    expect(auditText).not.toContain('血圧確認');
    expect(auditText).not.toContain('残薬管理');
    expect(auditText).not.toContain('急変リスクあり');
    expect(auditText).not.toContain('申し送り内容を確認済み');
  });

  it('redacts owner/admin override reasons in confirmation audit metadata', async () => {
    const existingHandoff = {
      next_check_items: ['血圧確認'],
      ongoing_monitoring: ['残薬管理'],
      decision_rationale: '急変リスクあり',
      ai_extracted: true,
      ai_confidence: 0.85,
      confirmed_by: null,
      confirmed_at: null,
      extracted_at: '2026-04-01T00:00:00Z',
    };
    const overrideReason = ' 患者 田中太郎 の急変対応 token=secret のため管理者確認 ';

    const visitRecordFindUniqueOrThrowMock = vi.fn().mockResolvedValue({
      version: 2,
      schedule_id: 'schedule-1',
      structured_soap: { ...baseSoap, handoff: existingHandoff },
    });
    const visitRecordUpdateManyMock = vi.fn().mockResolvedValue({ count: 1 });
    resolveOperationalTasksMock.mockResolvedValue({ count: 1 });
    createAuditLogEntryMock.mockResolvedValue({ id: 'audit-1' });

    withOrgContextMock.mockImplementation(
      async (_orgId: string, fn: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          visitRecord: {
            findUniqueOrThrow: visitRecordFindUniqueOrThrowMock,
            updateMany: visitRecordUpdateManyMock,
          },
          auditLog: { create: vi.fn() },
        };
        return fn(tx);
      },
    );

    const db = {} as Parameters<typeof confirmHandoff>[0];
    await confirmHandoff(db, {
      orgId: 'org-1',
      visitRecordId: 'vr-1',
      confirmedBy: 'owner-1',
      expectedVersion: 2,
      requestContext: {
        orgId: 'org-1',
        userId: 'owner-1',
        role: 'owner',
        ipAddress: '127.0.0.1',
        userAgent: 'test',
      },
      confirmationBasis: 'admin_emergency_override',
      overrideReason,
    });

    expect(createAuditLogEntryMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ orgId: 'org-1', userId: 'owner-1' }),
      expect.objectContaining({
        action: 'visit_handoff_confirmed',
        changes: expect.objectContaining({
          authorized_basis: 'admin_emergency_override',
          override_reason_present: true,
          override_reason_length: overrideReason.trim().length,
          override_reason_redacted: true,
        }),
      }),
    );
    const auditText = JSON.stringify(createAuditLogEntryMock.mock.calls);
    expect(auditText).not.toContain('田中太郎');
    expect(auditText).not.toContain('token=secret');
    expect(auditText).not.toContain(overrideReason.trim());
  });

  it('resolves the selected supervision task and writes PHI-free co-sign audit metadata', async () => {
    const existingHandoff = {
      next_check_items: ['血圧確認'],
      ongoing_monitoring: ['残薬管理'],
      decision_rationale: '患者 田中太郎 token=secret の急変リスクあり',
      ai_extracted: true,
      ai_confidence: 0.85,
      confirmed_by: null,
      confirmed_at: null,
      extracted_at: '2026-04-01T00:00:00Z',
    };

    const visitRecordFindUniqueOrThrowMock = vi.fn().mockResolvedValue({
      version: 2,
      schedule_id: 'schedule-1',
      structured_soap: { ...baseSoap, handoff: existingHandoff },
    });
    const visitRecordUpdateManyMock = vi.fn().mockResolvedValue({ count: 1 });
    const taskUpdateManyMock = vi.fn().mockResolvedValue({ count: 1 });
    resolveOperationalTasksMock.mockResolvedValue({ count: 1 });
    createAuditLogEntryMock.mockResolvedValue({ id: 'audit-1' });

    withOrgContextMock.mockImplementation(
      async (_orgId: string, fn: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          visitRecord: {
            findUniqueOrThrow: visitRecordFindUniqueOrThrowMock,
            updateMany: visitRecordUpdateManyMock,
          },
          task: { updateMany: taskUpdateManyMock },
          auditLog: { create: vi.fn() },
        };
        return fn(tx);
      },
    );

    const db = {} as Parameters<typeof confirmHandoff>[0];
    await confirmHandoff(db, {
      orgId: 'org-1',
      visitRecordId: 'vr-1',
      confirmedBy: 'supervisor-1',
      expectedVersion: 2,
      requestContext: {
        orgId: 'org-1',
        userId: 'supervisor-1',
        role: 'pharmacist',
        ipAddress: '127.0.0.1',
        userAgent: 'test',
      },
      confirmationBasis: 'supervision_task_assignee',
      supervisionReview: {
        taskId: 'task-supervision-1',
        traineeUserId: 'trainee-1',
        supervisorUserId: 'supervisor-1',
        requestedVisitRecordVersion: 2,
      },
    });

    expect(taskUpdateManyMock).toHaveBeenCalledWith({
      where: {
        id: 'task-supervision-1',
        org_id: 'org-1',
        task_type: 'handoff_supervision_review',
        status: { in: ['pending', 'in_progress'] },
        assigned_to: 'supervisor-1',
        related_entity_type: 'visit_record',
        related_entity_id: 'vr-1',
      },
      data: { status: 'in_progress' },
    });
    expect(resolveOperationalTasksMock).toHaveBeenCalledWith(expect.anything(), {
      orgId: 'org-1',
      dedupeKey: 'handoff_confirm_vr-1',
      taskType: 'handoff_confirmation',
      assignedToUserId: 'supervisor-1',
      includeUnassigned: true,
    });
    expect(resolveOperationalTasksMock).toHaveBeenCalledWith(expect.anything(), {
      orgId: 'org-1',
      dedupeKey: 'handoff_confirm_vr-1',
      taskType: 'handoff_confirmation',
      assignedToUserId: 'trainee-1',
    });
    expect(resolveOperationalTasksMock).toHaveBeenCalledWith(expect.anything(), {
      orgId: 'org-1',
      taskId: 'task-supervision-1',
      taskType: 'handoff_supervision_review',
      relatedEntityType: 'visit_record',
      relatedEntityId: 'vr-1',
      assignedToUserId: 'supervisor-1',
    });
    expect(createAuditLogEntryMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ orgId: 'org-1', userId: 'supervisor-1' }),
      expect.objectContaining({
        action: 'visit_handoff_supervision_confirmed',
        targetType: 'visit_record',
        targetId: 'vr-1',
        changes: expect.objectContaining({
          visit_record_id: 'vr-1',
          schedule_id: 'schedule-1',
          handoff_supervision_task_id: 'task-supervision-1',
          trainee_user_id: 'trainee-1',
          supervisor_user_id: 'supervisor-1',
          confirmed_by: 'supervisor-1',
          authorized_basis: 'supervision_task_assignee',
          requested_visit_record_version: 2,
          confirmed_visit_record_version: 2,
          handoff_confirmation_tasks_resolved_count: 2,
          handoff_supervision_tasks_resolved_count: 1,
          before: expect.objectContaining({
            next_check_items_count: 1,
            ongoing_monitoring_count: 1,
            decision_rationale_present: true,
          }),
          after: expect.objectContaining({
            next_check_items_count: 1,
            ongoing_monitoring_count: 1,
            decision_rationale_present: true,
          }),
        }),
      }),
    );
    const auditAndTaskText = JSON.stringify([
      resolveOperationalTasksMock.mock.calls,
      createAuditLogEntryMock.mock.calls,
    ]);
    expect(auditAndTaskText).not.toContain('血圧確認');
    expect(auditAndTaskText).not.toContain('残薬管理');
    expect(auditAndTaskText).not.toContain('田中太郎');
    expect(auditAndTaskText).not.toContain('token=secret');
  });

  it('rejects lost supervision task claims before updating the visit record or audit', async () => {
    const existingHandoff = {
      next_check_items: ['血圧確認'],
      ongoing_monitoring: ['残薬管理'],
      decision_rationale: '急変リスクあり',
      ai_extracted: true,
      ai_confidence: 0.85,
      confirmed_by: null,
      confirmed_at: null,
      extracted_at: '2026-04-01T00:00:00Z',
    };

    const visitRecordFindUniqueOrThrowMock = vi.fn().mockResolvedValue({
      version: 2,
      schedule_id: 'schedule-1',
      structured_soap: { ...baseSoap, handoff: existingHandoff },
    });
    const visitRecordUpdateManyMock = vi.fn();
    const taskUpdateManyMock = vi.fn().mockResolvedValue({ count: 0 });

    withOrgContextMock.mockImplementation(
      async (_orgId: string, fn: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          visitRecord: {
            findUniqueOrThrow: visitRecordFindUniqueOrThrowMock,
            updateMany: visitRecordUpdateManyMock,
          },
          task: { updateMany: taskUpdateManyMock },
        };
        return fn(tx);
      },
    );

    const db = {} as Parameters<typeof confirmHandoff>[0];
    await expect(
      confirmHandoff(db, {
        orgId: 'org-1',
        visitRecordId: 'vr-1',
        confirmedBy: 'supervisor-1',
        expectedVersion: 2,
        confirmationBasis: 'supervision_task_assignee',
        supervisionReview: {
          taskId: 'task-supervision-1',
          traineeUserId: 'trainee-1',
          supervisorUserId: 'supervisor-1',
          requestedVisitRecordVersion: 2,
        },
      }),
    ).rejects.toBeInstanceOf(VisitHandoffSupervisionTaskUnavailableError);

    expect(visitRecordUpdateManyMock).not.toHaveBeenCalled();
    expect(resolveOperationalTasksMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
  });

  it('applies edits during confirmation', async () => {
    const existingHandoff = {
      next_check_items: ['旧項目'],
      ongoing_monitoring: ['旧モニタリング'],
      decision_rationale: '旧根拠',
      ai_extracted: true,
      ai_confidence: 0.9,
      confirmed_by: null,
      confirmed_at: null,
      extracted_at: '2026-04-01T00:00:00Z',
    };

    const visitRecordFindUniqueOrThrowMock = vi.fn().mockResolvedValue({
      version: 2,
      structured_soap: { ...baseSoap, handoff: existingHandoff },
    });
    const visitRecordUpdateManyMock = vi.fn().mockResolvedValue({ count: 1 });
    resolveOperationalTasksMock.mockResolvedValue({ count: 1 });

    withOrgContextMock.mockImplementation(
      async (_orgId: string, fn: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          visitRecord: {
            findUniqueOrThrow: visitRecordFindUniqueOrThrowMock,
            updateMany: visitRecordUpdateManyMock,
          },
        };
        return fn(tx);
      },
    );

    const db = {} as Parameters<typeof confirmHandoff>[0];
    const result = await confirmHandoff(db, {
      orgId: 'org-1',
      visitRecordId: 'vr-1',
      confirmedBy: 'user-2',
      expectedVersion: 2,
      edits: {
        next_check_items: ['新項目A', '新項目B'],
        decision_rationale: '更新された根拠',
      },
    });

    expect(result.next_check_items).toEqual(['新項目A', '新項目B']);
    expect(result.decision_rationale).toBe('更新された根拠');
    expect(result.ongoing_monitoring).toEqual(['旧モニタリング']); // not edited
  });

  it('rejects edits that remove all clinical handoff content before resolving the confirmation task', async () => {
    const existingHandoff = {
      next_check_items: ['旧項目'],
      ongoing_monitoring: ['旧モニタリング'],
      decision_rationale: '旧根拠',
      ai_extracted: true,
      ai_confidence: 0.9,
      confirmed_by: null,
      confirmed_at: null,
      extracted_at: '2026-04-01T00:00:00Z',
    };

    const visitRecordFindUniqueOrThrowMock = vi.fn().mockResolvedValue({
      version: 2,
      structured_soap: { ...baseSoap, handoff: existingHandoff },
    });
    const visitRecordUpdateManyMock = vi.fn();

    withOrgContextMock.mockImplementation(
      async (_orgId: string, fn: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          visitRecord: {
            findUniqueOrThrow: visitRecordFindUniqueOrThrowMock,
            updateMany: visitRecordUpdateManyMock,
          },
        };
        return fn(tx);
      },
    );

    const db = {} as Parameters<typeof confirmHandoff>[0];
    await expect(
      confirmHandoff(db, {
        orgId: 'org-1',
        visitRecordId: 'vr-1',
        confirmedBy: 'user-2',
        expectedVersion: 2,
        edits: {
          next_check_items: [],
          ongoing_monitoring: [],
          decision_rationale: '   ',
        },
      }),
    ).rejects.toBeInstanceOf(VisitHandoffInvalidDataError);

    expect(visitRecordUpdateManyMock).not.toHaveBeenCalled();
    expect(resolveOperationalTasksMock).not.toHaveBeenCalled();
  });

  it('throws when no handoff exists on visit record', async () => {
    const visitRecordFindUniqueOrThrowMock = vi.fn().mockResolvedValue({
      version: 2,
      structured_soap: baseSoap, // no handoff field
    });
    const visitRecordUpdateManyMock = vi.fn();

    withOrgContextMock.mockImplementation(
      async (_orgId: string, fn: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          visitRecord: {
            findUniqueOrThrow: visitRecordFindUniqueOrThrowMock,
            updateMany: visitRecordUpdateManyMock,
          },
        };
        return fn(tx);
      },
    );

    const db = {} as Parameters<typeof confirmHandoff>[0];
    await expect(
      confirmHandoff(db, {
        orgId: 'org-1',
        visitRecordId: 'vr-1',
        confirmedBy: 'user-1',
        expectedVersion: 2,
      }),
    ).rejects.toBeInstanceOf(VisitHandoffMissingDataError);
    expect(visitRecordUpdateManyMock).not.toHaveBeenCalled();
    expect(resolveOperationalTasksMock).not.toHaveBeenCalled();
  });

  it('throws when persisted handoff is not an object', async () => {
    const visitRecordFindUniqueOrThrowMock = vi.fn().mockResolvedValue({
      version: 2,
      structured_soap: {
        ...baseSoap,
        handoff: ['unexpected'],
      },
    });
    const visitRecordUpdateManyMock = vi.fn();

    withOrgContextMock.mockImplementation(
      async (_orgId: string, fn: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          visitRecord: {
            findUniqueOrThrow: visitRecordFindUniqueOrThrowMock,
            updateMany: visitRecordUpdateManyMock,
          },
        };
        return fn(tx);
      },
    );

    const db = {} as Parameters<typeof confirmHandoff>[0];
    await expect(
      confirmHandoff(db, {
        orgId: 'org-1',
        visitRecordId: 'vr-1',
        confirmedBy: 'user-1',
        expectedVersion: 2,
      }),
    ).rejects.toBeInstanceOf(VisitHandoffInvalidDataError);
    expect(visitRecordUpdateManyMock).not.toHaveBeenCalled();
    expect(resolveOperationalTasksMock).not.toHaveBeenCalled();
  });

  it('rejects already confirmed handoffs before writing or resolving tasks', async () => {
    const visitRecordFindUniqueOrThrowMock = vi.fn().mockResolvedValue({
      version: 2,
      structured_soap: {
        ...baseSoap,
        handoff: {
          next_check_items: ['血圧確認'],
          ongoing_monitoring: ['残薬管理'],
          decision_rationale: '急変リスクあり',
          ai_extracted: true,
          ai_confidence: 0.85,
          confirmed_by: 'user-1',
          confirmed_at: '2026-04-01T00:00:00Z',
          extracted_at: '2026-04-01T00:00:00Z',
        },
      },
    });
    const visitRecordUpdateManyMock = vi.fn();

    withOrgContextMock.mockImplementation(
      async (_orgId: string, fn: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          visitRecord: {
            findUniqueOrThrow: visitRecordFindUniqueOrThrowMock,
            updateMany: visitRecordUpdateManyMock,
          },
        };
        return fn(tx);
      },
    );

    const db = {} as Parameters<typeof confirmHandoff>[0];
    await expect(
      confirmHandoff(db, {
        orgId: 'org-1',
        visitRecordId: 'vr-1',
        confirmedBy: 'supervisor-1',
        expectedVersion: 2,
      }),
    ).rejects.toBeInstanceOf(VisitHandoffAlreadyConfirmedError);
    expect(visitRecordUpdateManyMock).not.toHaveBeenCalled();
    expect(resolveOperationalTasksMock).not.toHaveBeenCalled();
  });

  it('throws when persisted handoff is structurally incomplete', async () => {
    const visitRecordFindUniqueOrThrowMock = vi.fn().mockResolvedValue({
      version: 2,
      structured_soap: {
        ...baseSoap,
        handoff: {},
      },
    });
    const visitRecordUpdateManyMock = vi.fn();

    withOrgContextMock.mockImplementation(
      async (_orgId: string, fn: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          visitRecord: {
            findUniqueOrThrow: visitRecordFindUniqueOrThrowMock,
            updateMany: visitRecordUpdateManyMock,
          },
        };
        return fn(tx);
      },
    );

    const db = {} as Parameters<typeof confirmHandoff>[0];
    await expect(
      confirmHandoff(db, {
        orgId: 'org-1',
        visitRecordId: 'vr-1',
        confirmedBy: 'user-1',
        expectedVersion: 2,
      }),
    ).rejects.toBeInstanceOf(VisitHandoffInvalidDataError);
    expect(visitRecordUpdateManyMock).not.toHaveBeenCalled();
    expect(resolveOperationalTasksMock).not.toHaveBeenCalled();
  });

  it('throws when persisted handoff metadata has the wrong type', async () => {
    const visitRecordFindUniqueOrThrowMock = vi.fn().mockResolvedValue({
      version: 2,
      structured_soap: {
        ...baseSoap,
        handoff: {
          next_check_items: ['血圧確認'],
          ongoing_monitoring: ['残薬管理'],
          decision_rationale: '急変リスクあり',
          ai_extracted: 'yes',
          ai_confidence: 0.85,
          confirmed_by: null,
          confirmed_at: null,
          extracted_at: '2026-04-01T00:00:00Z',
        },
      },
    });
    const visitRecordUpdateManyMock = vi.fn();

    withOrgContextMock.mockImplementation(
      async (_orgId: string, fn: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          visitRecord: {
            findUniqueOrThrow: visitRecordFindUniqueOrThrowMock,
            updateMany: visitRecordUpdateManyMock,
          },
        };
        return fn(tx);
      },
    );

    const db = {} as Parameters<typeof confirmHandoff>[0];
    await expect(
      confirmHandoff(db, {
        orgId: 'org-1',
        visitRecordId: 'vr-1',
        confirmedBy: 'user-1',
        expectedVersion: 2,
      }),
    ).rejects.toBeInstanceOf(VisitHandoffInvalidDataError);
    expect(visitRecordUpdateManyMock).not.toHaveBeenCalled();
    expect(resolveOperationalTasksMock).not.toHaveBeenCalled();
  });

  it('throws when persisted handoff has no clinical content', async () => {
    const visitRecordFindUniqueOrThrowMock = vi.fn().mockResolvedValue({
      version: 2,
      structured_soap: {
        ...baseSoap,
        handoff: {
          next_check_items: [],
          ongoing_monitoring: [],
          decision_rationale: null,
          ai_extracted: true,
          ai_confidence: 0.3,
          confirmed_by: null,
          confirmed_at: null,
          extracted_at: '2026-04-01T00:00:00Z',
        },
      },
    });
    const visitRecordUpdateManyMock = vi.fn();

    withOrgContextMock.mockImplementation(
      async (_orgId: string, fn: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          visitRecord: {
            findUniqueOrThrow: visitRecordFindUniqueOrThrowMock,
            updateMany: visitRecordUpdateManyMock,
          },
        };
        return fn(tx);
      },
    );

    const db = {} as Parameters<typeof confirmHandoff>[0];
    await expect(
      confirmHandoff(db, {
        orgId: 'org-1',
        visitRecordId: 'vr-1',
        confirmedBy: 'user-1',
        expectedVersion: 2,
      }),
    ).rejects.toBeInstanceOf(VisitHandoffInvalidDataError);
    expect(visitRecordUpdateManyMock).not.toHaveBeenCalled();
    expect(resolveOperationalTasksMock).not.toHaveBeenCalled();
  });

  it('throws when persisted handoff content is blank-only', async () => {
    const visitRecordFindUniqueOrThrowMock = vi.fn().mockResolvedValue({
      version: 2,
      structured_soap: {
        ...baseSoap,
        handoff: {
          next_check_items: ['   '],
          ongoing_monitoring: [''],
          decision_rationale: '  ',
          ai_extracted: true,
          ai_confidence: 0.3,
          confirmed_by: null,
          confirmed_at: null,
          extracted_at: '2026-04-01T00:00:00Z',
        },
      },
    });
    const visitRecordUpdateManyMock = vi.fn();

    withOrgContextMock.mockImplementation(
      async (_orgId: string, fn: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          visitRecord: {
            findUniqueOrThrow: visitRecordFindUniqueOrThrowMock,
            updateMany: visitRecordUpdateManyMock,
          },
        };
        return fn(tx);
      },
    );

    const db = {} as Parameters<typeof confirmHandoff>[0];
    await expect(
      confirmHandoff(db, {
        orgId: 'org-1',
        visitRecordId: 'vr-1',
        confirmedBy: 'user-1',
        expectedVersion: 2,
      }),
    ).rejects.toBeInstanceOf(VisitHandoffInvalidDataError);
    expect(visitRecordUpdateManyMock).not.toHaveBeenCalled();
    expect(resolveOperationalTasksMock).not.toHaveBeenCalled();
  });

  it('rejects stale visit record versions before resolving the confirmation task', async () => {
    const existingHandoff = {
      next_check_items: ['血圧確認'],
      ongoing_monitoring: ['残薬管理'],
      decision_rationale: '急変リスクあり',
      ai_extracted: true,
      ai_confidence: 0.85,
      confirmed_by: null,
      confirmed_at: null,
      extracted_at: '2026-04-01T00:00:00Z',
    };

    const visitRecordFindUniqueOrThrowMock = vi.fn().mockResolvedValue({
      version: 3,
      structured_soap: { ...baseSoap, handoff: existingHandoff },
    });
    const visitRecordUpdateManyMock = vi.fn();

    withOrgContextMock.mockImplementation(
      async (_orgId: string, fn: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          visitRecord: {
            findUniqueOrThrow: visitRecordFindUniqueOrThrowMock,
            updateMany: visitRecordUpdateManyMock,
          },
        };
        return fn(tx);
      },
    );

    const db = {} as Parameters<typeof confirmHandoff>[0];
    await expect(
      confirmHandoff(db, {
        orgId: 'org-1',
        visitRecordId: 'vr-1',
        confirmedBy: 'user-1',
        expectedVersion: 2,
      }),
    ).rejects.toThrow('changed before handoff extraction');

    expect(visitRecordUpdateManyMock).not.toHaveBeenCalled();
    expect(resolveOperationalTasksMock).not.toHaveBeenCalled();
  });

  it('rejects lost confirmation claims before resolving the confirmation task', async () => {
    const existingHandoff = {
      next_check_items: ['血圧確認'],
      ongoing_monitoring: ['残薬管理'],
      decision_rationale: '急変リスクあり',
      ai_extracted: true,
      ai_confidence: 0.85,
      confirmed_by: null,
      confirmed_at: null,
      extracted_at: '2026-04-01T00:00:00Z',
    };

    const visitRecordFindUniqueOrThrowMock = vi.fn().mockResolvedValue({
      version: 2,
      structured_soap: { ...baseSoap, handoff: existingHandoff },
    });
    const visitRecordUpdateManyMock = vi.fn().mockResolvedValue({ count: 0 });

    withOrgContextMock.mockImplementation(
      async (_orgId: string, fn: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          visitRecord: {
            findUniqueOrThrow: visitRecordFindUniqueOrThrowMock,
            updateMany: visitRecordUpdateManyMock,
          },
        };
        return fn(tx);
      },
    );

    const db = {} as Parameters<typeof confirmHandoff>[0];
    await expect(
      confirmHandoff(db, {
        orgId: 'org-1',
        visitRecordId: 'vr-1',
        confirmedBy: 'user-1',
        expectedVersion: 2,
      }),
    ).rejects.toThrow('changed before handoff extraction');

    expect(visitRecordUpdateManyMock).toHaveBeenCalledOnce();
    expect(resolveOperationalTasksMock).not.toHaveBeenCalled();
  });
});

describe('requestHandoffConfirmationSupervision', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a dedicated supervisor task and PHI-free audit without final confirmation mutation', async () => {
    const existingHandoff = {
      next_check_items: ['血圧確認'],
      ongoing_monitoring: ['残薬管理'],
      decision_rationale: '患者 田中太郎 token=secret の急変リスクあり',
      ai_extracted: true,
      ai_confidence: 0.85,
      confirmed_by: null,
      confirmed_at: null,
      extracted_at: '2026-04-01T00:00:00Z',
    };
    const requestNote = ' 患者 田中太郎 token=secret のため上長確認をお願いします ';

    const visitRecordFindUniqueOrThrowMock = vi.fn().mockResolvedValue({
      version: 2,
      schedule_id: 'schedule-1',
      structured_soap: { ...baseSoap, handoff: existingHandoff },
    });
    const visitRecordUpdateManyMock = vi.fn();
    upsertOperationalTaskMock.mockResolvedValue({ id: 'task-1' });
    createAuditLogEntryMock.mockResolvedValue({ id: 'audit-1' });

    withOrgContextMock.mockImplementation(
      async (_orgId: string, fn: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          visitRecord: {
            findUniqueOrThrow: visitRecordFindUniqueOrThrowMock,
            updateMany: visitRecordUpdateManyMock,
          },
          task: { upsert: vi.fn(), updateMany: vi.fn(), create: vi.fn() },
          auditLog: { create: vi.fn() },
        };
        return fn(tx);
      },
    );

    const db = {} as Parameters<typeof requestHandoffConfirmationSupervision>[0];
    const result = await requestHandoffConfirmationSupervision(db, {
      orgId: 'org-1',
      visitRecordId: 'vr-1',
      traineeUserId: 'trainee-1',
      supervisorUserId: 'supervisor-1',
      expectedVersion: 2,
      requestNote,
      requestContext: {
        orgId: 'org-1',
        userId: 'trainee-1',
        role: 'pharmacist_trainee',
        ipAddress: '127.0.0.1',
        userAgent: 'test',
      },
    });

    expect(result).toEqual({
      status: 'requested',
      task_type: 'handoff_supervision_review',
      assigned_to: 'supervisor-1',
      visit_record_id: 'vr-1',
      visit_record_version: 2,
    });
    expect(visitRecordUpdateManyMock).not.toHaveBeenCalled();
    expect(resolveOperationalTasksMock).not.toHaveBeenCalled();
    expect(upsertOperationalTaskMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        orgId: 'org-1',
        taskType: 'handoff_supervision_review',
        assignedTo: 'supervisor-1',
        dedupeKey: 'handoff_supervision_vr-1_trainee-1',
        relatedEntityType: 'visit_record',
        relatedEntityId: 'vr-1',
        metadata: expect.objectContaining({
          visit_record_id: 'vr-1',
          visit_record_version: 2,
          schedule_id: 'schedule-1',
          trainee_user_id: 'trainee-1',
          supervisor_user_id: 'supervisor-1',
          request_note_present: true,
          request_note_length: requestNote.trim().length,
          request_note_redacted: true,
        }),
      }),
    );
    expect(createAuditLogEntryMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ orgId: 'org-1', userId: 'trainee-1' }),
      expect.objectContaining({
        action: 'visit_handoff_supervision_requested',
        targetType: 'visit_record',
        targetId: 'vr-1',
        changes: expect.objectContaining({
          visit_record_id: 'vr-1',
          schedule_id: 'schedule-1',
          trainee_user_id: 'trainee-1',
          supervisor_user_id: 'supervisor-1',
          visit_record_version: 2,
          request_note_present: true,
          request_note_length: requestNote.trim().length,
          request_note_redacted: true,
          handoff: expect.objectContaining({
            next_check_items_count: 1,
            ongoing_monitoring_count: 1,
            decision_rationale_present: true,
          }),
        }),
      }),
    );
    const auditAndTaskText = JSON.stringify([
      upsertOperationalTaskMock.mock.calls,
      createAuditLogEntryMock.mock.calls,
    ]);
    expect(auditAndTaskText).not.toContain('血圧確認');
    expect(auditAndTaskText).not.toContain('残薬管理');
    expect(auditAndTaskText).not.toContain('田中太郎');
    expect(auditAndTaskText).not.toContain('token=secret');
    expect(auditAndTaskText).not.toContain(requestNote.trim());
  });

  it('rejects stale records before writing task or audit side effects', async () => {
    const existingHandoff = {
      next_check_items: ['血圧確認'],
      ongoing_monitoring: ['残薬管理'],
      decision_rationale: '急変リスクあり',
      ai_extracted: true,
      ai_confidence: 0.85,
      confirmed_by: null,
      confirmed_at: null,
      extracted_at: '2026-04-01T00:00:00Z',
    };

    const visitRecordFindUniqueOrThrowMock = vi.fn().mockResolvedValue({
      version: 3,
      schedule_id: 'schedule-1',
      structured_soap: { ...baseSoap, handoff: existingHandoff },
    });

    withOrgContextMock.mockImplementation(
      async (_orgId: string, fn: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          visitRecord: {
            findUniqueOrThrow: visitRecordFindUniqueOrThrowMock,
          },
        };
        return fn(tx);
      },
    );

    const db = {} as Parameters<typeof requestHandoffConfirmationSupervision>[0];
    await expect(
      requestHandoffConfirmationSupervision(db, {
        orgId: 'org-1',
        visitRecordId: 'vr-1',
        traineeUserId: 'trainee-1',
        supervisorUserId: 'supervisor-1',
        expectedVersion: 2,
      }),
    ).rejects.toThrow('changed before handoff extraction');

    expect(upsertOperationalTaskMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
  });

  it('rejects already confirmed handoffs before writing task or audit side effects', async () => {
    const existingHandoff = {
      next_check_items: ['血圧確認'],
      ongoing_monitoring: ['残薬管理'],
      decision_rationale: '急変リスクあり',
      ai_extracted: true,
      ai_confidence: 0.85,
      confirmed_by: 'supervisor-1',
      confirmed_at: '2026-04-01T02:00:00Z',
      extracted_at: '2026-04-01T00:00:00Z',
    };

    const visitRecordFindUniqueOrThrowMock = vi.fn().mockResolvedValue({
      version: 2,
      schedule_id: 'schedule-1',
      structured_soap: { ...baseSoap, handoff: existingHandoff },
    });

    withOrgContextMock.mockImplementation(
      async (_orgId: string, fn: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          visitRecord: {
            findUniqueOrThrow: visitRecordFindUniqueOrThrowMock,
          },
        };
        return fn(tx);
      },
    );

    const db = {} as Parameters<typeof requestHandoffConfirmationSupervision>[0];
    await expect(
      requestHandoffConfirmationSupervision(db, {
        orgId: 'org-1',
        visitRecordId: 'vr-1',
        traineeUserId: 'trainee-1',
        supervisorUserId: 'supervisor-1',
        expectedVersion: 2,
      }),
    ).rejects.toThrow(VisitHandoffAlreadyConfirmedError);

    expect(upsertOperationalTaskMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
  });
});
