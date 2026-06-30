import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/client', () => ({
  prisma: {
    patient: {
      findFirst: vi.fn(),
    },
    patientMcsLink: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
    },
    patientMcsMessage: {
      findMany: vi.fn(),
      upsert: vi.fn(),
      deleteMany: vi.fn(),
    },
    patientMcsSummary: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      upsert: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: vi.fn(),
}));

const { generatePatientMcsAiSummaryMock } = vi.hoisted(() => ({
  generatePatientMcsAiSummaryMock: vi.fn(),
}));

vi.mock('./patient-mcs-ai', () => ({
  generatePatientMcsAiSummary: generatePatientMcsAiSummaryMock,
}));

import { prisma } from '@/lib/db/client';
import { withOrgContext } from '@/lib/db/rls';
import {
  extractPatientNameFromProjectTitle,
  generatePatientMcsSummarySafely,
  getPatientMcsOverview,
  isPatientMcsBrowserSyncEnabled,
  matchesPatientIdentity,
  normalizeMedicalCareStationUrl,
  normalizePatientMcsMessageLimit,
  normalizeMcsActivationPayload,
  normalizeScrapedMcsTimelinePayload,
  PATIENT_MCS_MAX_MESSAGE_LIMIT,
  parseAgentBrowserEvalJson,
  parseMcsAuthorDescriptor,
  parseMcsPostedAtLabel,
  sanitizePatientMcsExternalErrorMessage,
  syncPatientMcsTimeline,
} from './patient-mcs';

type TransactionCallback = Parameters<typeof withOrgContext>[1];
type TransactionClient = Parameters<TransactionCallback>[0];

function buildScrapedMcsTimeline(overrides: Record<string, unknown> = {}) {
  return {
    sourceUrl: 'https://www.medical-care.net/patients/123',
    mcsPatientId: '123',
    mcsPatientUrl: 'https://www.medical-care.net/patients/123',
    mcsProjectId: 'project_new',
    mcsProjectUrl: 'https://www.medical-care.net/projects/medical/project_new',
    projectTitle: '板屋 美恵子：年長者の里',
    projectMemo: null,
    memberCount: 4,
    mcsPatientName: '板屋 美恵子',
    messages: [
      {
        sourceMessageId: 'message_new',
        authorName: '看護師 佐藤',
        authorDescriptor: '看護師（訪問看護）',
        postedAtLabel: '4/2 12:12',
        body: '発熱なし',
        reactionCount: 1,
        replyCount: 0,
        sortOrder: 0,
        sourceUrl: 'https://www.medical-care.net/projects/medical/project_new#message-message_new',
      },
    ],
    ...overrides,
  };
}

function buildSavedMcsSummary() {
  return {
    id: 'summary_existing',
    generation_id: 'gen_existing',
    provider: 'rule',
    requested_provider: 'disabled',
    is_fallback: true,
    model: null,
    fallback_reason: 'provider_unavailable',
    headline: '既存の要約を保持',
    bullets: ['食欲低下の共有を確認'],
    must_check_today: [],
    suggested_actions: [],
    source_refs: ['message_old'],
    message_count: 1,
    other_professional_message_count: 1,
    latest_posted_at: new Date('2026-04-01T10:00:00.000Z'),
    generated_at: new Date('2026-04-01T10:01:00.000Z'),
    duration_ms: null,
  };
}

function buildPatientMcsSyncTx() {
  return {
    patientMcsLink: {
      upsert: vi.fn().mockResolvedValue({
        id: 'link_1',
        source_url: 'https://www.medical-care.net/patients/123',
        mcs_patient_id: '123',
        mcs_patient_url: 'https://www.medical-care.net/patients/123',
        mcs_project_id: 'project_new',
        mcs_project_url: 'https://www.medical-care.net/projects/medical/project_new',
        project_title: '板屋 美恵子：年長者の里',
        project_memo: null,
        member_count: 4,
        last_sync_attempt_at: new Date('2026-04-02T03:00:00.000Z'),
        last_synced_at: new Date('2026-04-02T03:00:00.000Z'),
        last_sync_status: 'success',
        last_sync_error: null,
      }),
    },
    patientMcsMessage: {
      upsert: vi.fn().mockResolvedValue({ id: 'message_new' }),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    patientMcsSummary: {
      upsert: vi.fn().mockResolvedValue({ id: 'summary_new' }),
      findUnique: vi.fn().mockResolvedValue(null),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
  };
}

function mockPatientMcsSyncLookups(existingProjectId = 'project_new') {
  vi.mocked(prisma.patient.findFirst).mockResolvedValueOnce({
    id: 'patient_1',
    name: '板屋 美恵子',
    name_kana: 'イタヤ ミエコ',
  } as never);
  vi.mocked(prisma.patientMcsLink.findUnique).mockResolvedValueOnce({
    id: 'link_1',
    source_url: 'https://www.medical-care.net/patients/123',
    mcs_patient_id: '123',
    mcs_project_id: existingProjectId,
  } as never);
}

function mockPatientMcsSyncTransaction(tx: ReturnType<typeof buildPatientMcsSyncTx>) {
  vi.mocked(withOrgContext).mockImplementationOnce(async (_orgId, callback) =>
    callback(tx as unknown as TransactionClient),
  );
}

describe('patient-mcs service helpers', () => {
  const originalEnv = {
    awsExecutionEnv: process.env.AWS_EXECUTION_ENV,
    mcsBrowserSyncEnabled: process.env.PATIENT_MCS_BROWSER_SYNC_ENABLED,
    vercel: process.env.VERCEL,
  };

  afterEach(() => {
    process.env.AWS_EXECUTION_ENV = originalEnv.awsExecutionEnv;
    process.env.PATIENT_MCS_BROWSER_SYNC_ENABLED = originalEnv.mcsBrowserSyncEnabled;
    process.env.VERCEL = originalEnv.vercel;
    vi.clearAllMocks();
  });

  it('normalizes medical-care URLs and strips hashes', () => {
    expect(
      normalizeMedicalCareStationUrl(
        'https://www.medical-care.net/projects/medical/57886227#message-123',
      ).toString(),
    ).toBe('https://www.medical-care.net/projects/medical/57886227');
  });

  it('rejects non-MCS hosts', () => {
    expect(() => normalizeMedicalCareStationUrl('https://example.com/patients/1')).toThrow(
      'Medical Care Station の URL を入力してください',
    );
  });

  it('rejects lookalike hosts and non-https URLs', () => {
    expect(() =>
      normalizeMedicalCareStationUrl('https://www.evilmedical-care.net/patients/1'),
    ).toThrow('Medical Care Station の URL を入力してください');
    expect(() => normalizeMedicalCareStationUrl('http://www.medical-care.net/patients/1')).toThrow(
      'Medical Care Station の URL を入力してください',
    );
  });

  it('splits author descriptor into role and organization', () => {
    expect(parseMcsAuthorDescriptor('看護師（年長者の里訪問看護ステーション）')).toEqual({
      authorRole: '看護師',
      authorOrganization: '年長者の里訪問看護ステーション',
      authorDescriptor: '看護師（年長者の里訪問看護ステーション）',
    });
  });

  it('supports author descriptors with ASCII parentheses', () => {
    expect(parseMcsAuthorDescriptor('看護師(年長者の里訪問看護ステーション)')).toEqual({
      authorRole: '看護師',
      authorOrganization: '年長者の里訪問看護ステーション',
      authorDescriptor: '看護師(年長者の里訪問看護ステーション)',
    });
  });

  it('parses month/day timestamps into the current or previous year', () => {
    const now = new Date('2026-01-05T10:00:00+09:00');
    expect(parseMcsPostedAtLabel('12/31 23:45', now)?.toISOString()).toBe(
      '2025-12-31T14:45:00.000Z',
    );
    expect(parseMcsPostedAtLabel('1/4', now)?.toISOString()).toBe('2026-01-03T15:00:00.000Z');
  });

  it('parses time-only labels as today or the previous day when needed', () => {
    const afternoon = new Date('2026-04-02T13:00:00+09:00');
    expect(parseMcsPostedAtLabel('12:12', afternoon)?.toISOString()).toBe(
      '2026-04-02T03:12:00.000Z',
    );

    const justAfterMidnight = new Date('2026-04-02T00:30:00+09:00');
    expect(parseMcsPostedAtLabel('23:50', justAfterMidnight)?.toISOString()).toBe(
      '2026-04-01T14:50:00.000Z',
    );
  });

  it('extracts the patient name from project titles', () => {
    expect(
      extractPatientNameFromProjectTitle('板屋 美恵子：年長者の里 | 中央町おだクリニック'),
    ).toBe('板屋 美恵子');
    expect(extractPatientNameFromProjectTitle(null)).toBeNull();
  });

  it('matches patient identity against MCS candidate names and kana', () => {
    expect(
      matchesPatientIdentity({ name: '板屋 美恵子', name_kana: 'イタヤ ミエコ' }, [
        '板屋 美恵子',
        '年長者の里',
      ]),
    ).toBe(true);

    expect(
      matchesPatientIdentity({ name: '板屋 美恵子', name_kana: 'イタヤ ミエコ' }, [
        '別患者',
        'ベツカンジャ',
      ]),
    ).toBe(false);

    expect(
      matchesPatientIdentity({ name: '板屋 美恵子', name_kana: 'イタヤ ミエコ' }, ['板屋']),
    ).toBe(false);
  });

  it('delegates summary generation to the MCS AI service', async () => {
    generatePatientMcsAiSummaryMock.mockResolvedValueOnce({
      generation_id: 'gen_1',
      provider: 'rule',
      requested_provider: 'disabled',
      is_fallback: true,
      model: null,
      fallback_reason: 'provider_unavailable',
      headline: '共有はまだありません。',
      bullets: [],
      must_check_today: [],
      suggested_actions: [],
      source_refs: [],
      message_count: 0,
      other_professional_message_count: 0,
      latest_posted_at: null,
      generated_at: '2026-04-02T08:00:00.000Z',
      duration_ms: null,
    });

    await expect(
      generatePatientMcsSummarySafely({
        patientName: '板屋 美恵子',
        projectTitle: '板屋 美恵子：年長者の里',
        messages: [],
      }),
    ).resolves.toMatchObject({
      generation_id: 'gen_1',
      provider: 'rule',
    });
  });

  it('logs summary fallback without raw exception text', async () => {
    const rawError = new Error('patient 山田太郎 MCS body token=secret');
    rawError.name = 'Patient山田SecretError';
    generatePatientMcsAiSummaryMock.mockRejectedValueOnce(rawError);
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(
      generatePatientMcsSummarySafely({
        patientName: '板屋 美恵子',
        projectTitle: '板屋 美恵子：年長者の里',
        messages: [],
      }),
    ).resolves.toBeNull();

    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    const logged = String(consoleErrorSpy.mock.calls[0]?.[0] ?? '');
    expect(logged).toContain('patient_mcs_summary_fallback');
    expect(logged).toContain('"code":"unknown_error"');
    expect(logged).toContain('"externalProvider":"patient_mcs_ai"');
    expect(logged).not.toContain('山田太郎');
    expect(logged).not.toContain('Patient山田SecretError');
    expect(logged).not.toContain('token=secret');

    consoleErrorSpy.mockRestore();
  });

  it('enables browser sync only with an explicit local opt-in', () => {
    delete process.env.VERCEL;
    delete process.env.AWS_EXECUTION_ENV;
    delete process.env.PATIENT_MCS_BROWSER_SYNC_ENABLED;
    expect(isPatientMcsBrowserSyncEnabled()).toBe(false);

    process.env.PATIENT_MCS_BROWSER_SYNC_ENABLED = 'true';
    expect(isPatientMcsBrowserSyncEnabled()).toBe(true);

    process.env.VERCEL = '1';
    expect(isPatientMcsBrowserSyncEnabled()).toBe(false);
  });

  it('sanitizes raw external sync errors before surfacing them', () => {
    expect(
      sanitizePatientMcsExternalErrorMessage(
        'spawn agent-browser ENOENT while connecting to Chrome',
      ),
    ).toBe(
      'MCS 連携用ブラウザに接続できません。ローカル端末で MCS にログインした Chrome を開いてから再試行してください。',
    );

    expect(
      sanitizePatientMcsExternalErrorMessage(
        'Medical Care Station にログイン済みの Chrome セッションが見つかりません',
      ),
    ).toBe('Medical Care Station にログイン済みの Chrome セッションが見つかりません');
  });

  it('decodes agent-browser eval output as a double-encoded JSON object', () => {
    expect(
      parseAgentBrowserEvalJson(JSON.stringify(JSON.stringify({ projectId: 'project_1' }))),
    ).toEqual({
      projectId: 'project_1',
    });
  });

  it('rejects malformed or non-object agent-browser eval output', () => {
    expect(() => parseAgentBrowserEvalJson('not-json')).toThrow(
      'MCS からデータを取得できませんでした',
    );
    expect(() => parseAgentBrowserEvalJson(JSON.stringify({ projectId: 'project_1' }))).toThrow(
      'MCS からデータを取得できませんでした',
    );
    expect(() => parseAgentBrowserEvalJson(JSON.stringify('not-json'))).toThrow(
      'MCS からデータを取得できませんでした',
    );
    expect(() => parseAgentBrowserEvalJson(JSON.stringify(JSON.stringify([])))).toThrow(
      'MCS からデータを取得できませんでした',
    );
    expect(() => parseAgentBrowserEvalJson(JSON.stringify(JSON.stringify(123)))).toThrow(
      'MCS からデータを取得できませんでした',
    );
  });

  it('normalizes agent-browser activation payloads before using project IDs', () => {
    expect(
      normalizeMcsActivationPayload({
        projectId: '57886227',
        currentUrl: 'https://www.medical-care.net/patients/123',
        patientName: '板屋 美恵子',
      }),
    ).toEqual({
      projectId: '57886227',
      currentUrl: 'https://www.medical-care.net/patients/123',
      patientName: '板屋 美恵子',
    });
    expect(
      normalizeMcsActivationPayload({
        projectId: 57886227,
        currentUrl: 'https://www.medical-care.net/patients/123',
        patientName: '板屋 美恵子',
      }),
    ).toBeNull();
    expect(
      normalizeMcsActivationPayload({
        projectId: '57886227',
        currentUrl: null,
        patientName: '板屋 美恵子',
      }),
    ).toBeNull();
  });

  it('normalizes scraped MCS timelines before syncing messages', () => {
    const validTimeline = {
      sourceUrl: 'https://www.medical-care.net/patients/123',
      mcsPatientId: '123',
      mcsPatientUrl: 'https://www.medical-care.net/patients/123',
      mcsProjectId: '57886227',
      mcsProjectUrl: 'https://www.medical-care.net/projects/medical/57886227',
      projectTitle: '板屋 美恵子：年長者の里',
      projectMemo: null,
      memberCount: 4,
      messages: [
        {
          sourceMessageId: 'message-1',
          authorName: '看護師 佐藤',
          authorDescriptor: '看護師（訪問看護）',
          postedAtLabel: '4/2 12:12',
          body: '発熱なし',
          reactionCount: 1,
          replyCount: 0,
          sortOrder: 0,
          sourceUrl: 'https://www.medical-care.net/projects/medical/57886227#message-message-1',
        },
      ],
    };

    expect(normalizeScrapedMcsTimelinePayload(validTimeline)).toEqual(validTimeline);
    expect(
      normalizeScrapedMcsTimelinePayload({
        ...validTimeline,
        messages: [{ ...validTimeline.messages[0], reactionCount: '1' }],
      }),
    ).toBeNull();
    expect(
      normalizeScrapedMcsTimelinePayload({
        ...validTimeline,
        messages: { sourceMessageId: 'message-1' },
      }),
    ).toBeNull();
  });

  it('upserts scraped MCS messages without deleting local messages missing from the latest scrape', async () => {
    mockPatientMcsSyncLookups();
    const tx = buildPatientMcsSyncTx();
    mockPatientMcsSyncTransaction(tx);
    generatePatientMcsAiSummaryMock.mockResolvedValueOnce(null);

    await expect(
      syncPatientMcsTimeline(
        {
          orgId: 'org_1',
          patientId: 'patient_1',
          userId: 'user_1',
        },
        {
          now: () => new Date('2026-04-02T03:00:00.000Z'),
          scrapeTimeline: async () => buildScrapedMcsTimeline({ mcsProjectId: 'project_new' }),
        },
      ),
    ).resolves.toMatchObject({
      importedCount: 1,
      latestMessageAt: new Date('2026-04-02T03:12:00.000Z'),
    });

    expect(tx.patientMcsMessage.upsert).toHaveBeenCalledTimes(1);
    expect(tx.patientMcsMessage.deleteMany).not.toHaveBeenCalled();
    expect(tx.patientMcsSummary.deleteMany).not.toHaveBeenCalled();
  });

  it('preserves existing MCS messages and summary when the linked project changes and summary generation fails', async () => {
    mockPatientMcsSyncLookups('project_old');
    const tx = buildPatientMcsSyncTx();
    const existingSummary = buildSavedMcsSummary();
    tx.patientMcsSummary.findUnique.mockResolvedValueOnce(existingSummary);
    mockPatientMcsSyncTransaction(tx);
    generatePatientMcsAiSummaryMock.mockRejectedValueOnce(new Error('temporary AI failure'));
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(
      syncPatientMcsTimeline(
        {
          orgId: 'org_1',
          patientId: 'patient_1',
          userId: 'user_1',
        },
        {
          now: () => new Date('2026-04-02T03:00:00.000Z'),
          scrapeTimeline: async () => buildScrapedMcsTimeline({ mcsProjectId: 'project_new' }),
        },
      ),
    ).resolves.toMatchObject({
      importedCount: 1,
      summary: { id: 'summary_existing', headline: '既存の要約を保持' },
    });

    expect(tx.patientMcsMessage.upsert).toHaveBeenCalledTimes(1);
    expect(tx.patientMcsMessage.deleteMany).not.toHaveBeenCalled();
    expect(tx.patientMcsSummary.upsert).not.toHaveBeenCalled();
    expect(tx.patientMcsSummary.deleteMany).not.toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
  });

  it('normalizes overview message limits before querying messages', async () => {
    const tx = {
      patientMcsLink: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'link_1',
          source_url: 'https://www.medical-care.net/patients/1',
          mcs_patient_id: '1',
          mcs_patient_url: 'https://www.medical-care.net/patients/1',
          mcs_project_id: '57886227',
          mcs_project_url: 'https://www.medical-care.net/projects/medical/57886227',
          project_title: '青葉 花子：年長者の里',
          project_memo: null,
          member_count: 9,
          last_sync_attempt_at: null,
          last_synced_at: null,
          last_sync_status: null,
          last_sync_error: null,
        }),
      },
      patientMcsSummary: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
      patientMcsMessage: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      communicationEvent: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'mcs_log_1',
            subject: 'MCS 報告確認',
            content: '食欲低下の共有を確認',
            counterpart_name: '青葉 花子：年長者の里',
            occurred_at: new Date('2026-04-02T09:00:00.000Z'),
            created_at: new Date('2026-04-02T09:01:00.000Z'),
          },
        ]),
      },
      task: {
        findFirst: vi.fn().mockResolvedValue({
          metadata: {
            linked_status: 'linked',
            participation_status: 'joined',
            pharmacy_participants: ['薬剤師 佐藤'],
            counterpart_roles: ['visiting_nurse'],
            last_checked_at: '2026-04-02T09:00:00.000Z',
            note: '訪問看護投稿を毎朝確認',
          },
          updated_at: new Date('2026-04-02T09:02:00.000Z'),
        }),
      },
    };
    vi.mocked(withOrgContext).mockImplementationOnce(async (_orgId, callback) =>
      callback(tx as unknown as TransactionClient),
    );

    await expect(
      getPatientMcsOverview({
        orgId: 'org_1',
        patientId: 'patient_1',
        limit: 999,
      }),
    ).resolves.toMatchObject({
      link: { id: 'link_1' },
      profile: {
        linked_status: 'linked',
        participation_status: 'joined',
        pharmacy_participants: ['薬剤師 佐藤'],
        counterpart_roles: ['visiting_nurse'],
        note: '訪問看護投稿を毎朝確認',
      },
      messages: [],
      checkLogs: [{ id: 'mcs_log_1' }],
    });

    expect(tx.patientMcsMessage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: PATIENT_MCS_MAX_MESSAGE_LIMIT,
      }),
    );
    expect(tx.communicationEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          event_type: 'mcs_check',
          patient_id: 'patient_1',
        }),
        take: 5,
      }),
    );
    expect(tx.task.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          task_type: 'patient_mcs_profile',
          related_entity_type: 'patient',
          related_entity_id: 'patient_1',
        }),
      }),
    );
  });

  it('normalizes direct overview limit inputs defensively', () => {
    expect(normalizePatientMcsMessageLimit(undefined)).toBe(50);
    expect(normalizePatientMcsMessageLimit(0)).toBe(0);
    expect(normalizePatientMcsMessageLimit(25.9)).toBe(25);
    expect(normalizePatientMcsMessageLimit(-5)).toBe(0);
    expect(normalizePatientMcsMessageLimit(Number.POSITIVE_INFINITY)).toBe(50);
    expect(normalizePatientMcsMessageLimit(999)).toBe(PATIENT_MCS_MAX_MESSAGE_LIMIT);
  });
});
