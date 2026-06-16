import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  extractHandoffFromSoapMock,
  withOrgContextMock,
  upsertOperationalTaskMock,
  resolveOperationalTasksMock,
} = vi.hoisted(() => ({
  extractHandoffFromSoapMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  upsertOperationalTaskMock: vi.fn(),
  resolveOperationalTasksMock: vi.fn(),
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

import { processHandoffExtraction, confirmHandoff } from './visit-handoff';
import type { StructuredSoap } from '@/types/structured-soap';

const baseSoap: StructuredSoap = {
  subjective: { symptom_checks: [] },
  objective: { medication_status: 'full_compliance', adherence_score: 3, side_effect_checks: [] },
  assessment: { problem_checks: [] },
  plan: { intervention_checks: [] },
};

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
    extractHandoffFromSoapMock.mockRejectedValue(new Error('model timeout'));

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
    ).rejects.toThrow('model timeout');

    expect(visitRecordUpdateManyMock).not.toHaveBeenCalled();
    expect(visitHandoffExtractionUpsertMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          status: 'failed',
          retry_count: { increment: 1 },
          error_message: 'model timeout',
          retryable: true,
        }),
      }),
    );
    expect(upsertOperationalTaskMock).not.toHaveBeenCalled();
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
      structured_soap: { ...baseSoap, handoff: existingHandoff },
    });
    const visitRecordUpdateMock = vi.fn().mockResolvedValue({});
    resolveOperationalTasksMock.mockResolvedValue({ count: 1 });

    withOrgContextMock.mockImplementation(
      async (_orgId: string, fn: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          visitRecord: {
            findUniqueOrThrow: visitRecordFindUniqueOrThrowMock,
            update: visitRecordUpdateMock,
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
    });

    expect(result.confirmed_by).toBe('user-1');
    expect(result.confirmed_at).toBeTruthy();
    expect(result.next_check_items).toEqual(['血圧確認']);
    expect(visitRecordUpdateMock).toHaveBeenCalledWith({
      where: { id: 'vr-1' },
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
      },
    });

    expect(resolveOperationalTasksMock).toHaveBeenCalledOnce();
    const resolveCall = resolveOperationalTasksMock.mock.calls[0][1];
    expect(resolveCall.dedupeKey).toBe('handoff_confirm_vr-1');
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
      structured_soap: { ...baseSoap, handoff: existingHandoff },
    });
    const visitRecordUpdateMock = vi.fn().mockResolvedValue({});
    resolveOperationalTasksMock.mockResolvedValue({ count: 1 });

    withOrgContextMock.mockImplementation(
      async (_orgId: string, fn: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          visitRecord: {
            findUniqueOrThrow: visitRecordFindUniqueOrThrowMock,
            update: visitRecordUpdateMock,
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
      edits: {
        next_check_items: ['新項目A', '新項目B'],
        decision_rationale: '更新された根拠',
      },
    });

    expect(result.next_check_items).toEqual(['新項目A', '新項目B']);
    expect(result.decision_rationale).toBe('更新された根拠');
    expect(result.ongoing_monitoring).toEqual(['旧モニタリング']); // not edited
  });

  it('throws when no handoff exists on visit record', async () => {
    const visitRecordFindUniqueOrThrowMock = vi.fn().mockResolvedValue({
      structured_soap: baseSoap, // no handoff field
    });

    withOrgContextMock.mockImplementation(
      async (_orgId: string, fn: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          visitRecord: {
            findUniqueOrThrow: visitRecordFindUniqueOrThrowMock,
            update: vi.fn(),
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
      }),
    ).rejects.toThrow('No handoff found');
  });

  it('throws when persisted handoff is malformed', async () => {
    const visitRecordFindUniqueOrThrowMock = vi.fn().mockResolvedValue({
      structured_soap: {
        ...baseSoap,
        handoff: ['unexpected'],
      },
    });

    withOrgContextMock.mockImplementation(
      async (_orgId: string, fn: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          visitRecord: {
            findUniqueOrThrow: visitRecordFindUniqueOrThrowMock,
            update: vi.fn(),
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
      }),
    ).rejects.toThrow('No handoff found');
  });
});
