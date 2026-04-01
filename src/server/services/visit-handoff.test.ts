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

const baseSoap = {
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
    });
    const visitRecordUpdateMock = vi.fn().mockResolvedValue({});
    upsertOperationalTaskMock.mockResolvedValue({ id: 'task-1' });

    withOrgContextMock.mockImplementation(async (_orgId: string, fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        visitRecord: {
          findUniqueOrThrow: visitRecordFindUniqueOrThrowMock,
          update: visitRecordUpdateMock,
        },
      };
      return fn(tx);
    });

    const db = {} as Parameters<typeof processHandoffExtraction>[0];
    const result = await processHandoffExtraction(db, {
      orgId: 'org-1',
      visitRecordId: 'vr-1',
      patientId: 'p-1',
      patientName: '田中太郎',
      structuredSoap: baseSoap as never,
      soapAssessment: '状態安定',
      soapPlan: '継続処方',
    });

    expect(extractHandoffFromSoapMock).toHaveBeenCalledOnce();
    expect(result.next_check_items).toEqual(['血圧確認']);
    expect(result.ai_extracted).toBe(true);
    expect(result.ai_confidence).toBe(0.85);

    // Verify the task was upserted
    expect(upsertOperationalTaskMock).toHaveBeenCalledOnce();
    const taskCall = upsertOperationalTaskMock.mock.calls[0][1];
    expect(taskCall.taskType).toBe('handoff_confirmation');
    expect(taskCall.dedupeKey).toBe('handoff_confirm_vr-1');
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

    withOrgContextMock.mockImplementation(async (_orgId: string, fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        visitRecord: {
          findUniqueOrThrow: visitRecordFindUniqueOrThrowMock,
          update: visitRecordUpdateMock,
        },
      };
      return fn(tx);
    });

    const db = {} as Parameters<typeof confirmHandoff>[0];
    const result = await confirmHandoff(db, {
      orgId: 'org-1',
      visitRecordId: 'vr-1',
      confirmedBy: 'user-1',
    });

    expect(result.confirmed_by).toBe('user-1');
    expect(result.confirmed_at).toBeTruthy();
    expect(result.next_check_items).toEqual(['血圧確認']);

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

    withOrgContextMock.mockImplementation(async (_orgId: string, fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        visitRecord: {
          findUniqueOrThrow: visitRecordFindUniqueOrThrowMock,
          update: visitRecordUpdateMock,
        },
      };
      return fn(tx);
    });

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

    withOrgContextMock.mockImplementation(async (_orgId: string, fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        visitRecord: {
          findUniqueOrThrow: visitRecordFindUniqueOrThrowMock,
          update: vi.fn(),
        },
      };
      return fn(tx);
    });

    const db = {} as Parameters<typeof confirmHandoff>[0];
    await expect(
      confirmHandoff(db, {
        orgId: 'org-1',
        visitRecordId: 'vr-1',
        confirmedBy: 'user-1',
      })
    ).rejects.toThrow('No handoff found');
  });
});
