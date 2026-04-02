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

import {
  extractPatientNameFromProjectTitle,
  generatePatientMcsSummarySafely,
  isPatientMcsBrowserSyncEnabled,
  matchesPatientIdentity,
  normalizeMedicalCareStationUrl,
  parseMcsAuthorDescriptor,
  parseMcsPostedAtLabel,
  sanitizePatientMcsExternalErrorMessage,
} from './patient-mcs';

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
  });

  it('normalizes medical-care URLs and strips hashes', () => {
    expect(
      normalizeMedicalCareStationUrl(
        'https://www.medical-care.net/projects/medical/57886227#message-123'
      ).toString()
    ).toBe('https://www.medical-care.net/projects/medical/57886227');
  });

  it('rejects non-MCS hosts', () => {
    expect(() => normalizeMedicalCareStationUrl('https://example.com/patients/1')).toThrow(
      'Medical Care Station の URL を入力してください'
    );
  });

  it('rejects lookalike hosts and non-https URLs', () => {
    expect(() =>
      normalizeMedicalCareStationUrl('https://www.evilmedical-care.net/patients/1')
    ).toThrow('Medical Care Station の URL を入力してください');
    expect(() => normalizeMedicalCareStationUrl('http://www.medical-care.net/patients/1')).toThrow(
      'Medical Care Station の URL を入力してください'
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
      '2025-12-31T14:45:00.000Z'
    );
    expect(parseMcsPostedAtLabel('1/4', now)?.toISOString()).toBe('2026-01-03T15:00:00.000Z');
  });

  it('parses time-only labels as today or the previous day when needed', () => {
    const afternoon = new Date('2026-04-02T13:00:00+09:00');
    expect(parseMcsPostedAtLabel('12:12', afternoon)?.toISOString()).toBe(
      '2026-04-02T03:12:00.000Z'
    );

    const justAfterMidnight = new Date('2026-04-02T00:30:00+09:00');
    expect(parseMcsPostedAtLabel('23:50', justAfterMidnight)?.toISOString()).toBe(
      '2026-04-01T14:50:00.000Z'
    );
  });

  it('extracts the patient name from project titles', () => {
    expect(extractPatientNameFromProjectTitle('板屋 美恵子：年長者の里 | 中央町おだクリニック')).toBe(
      '板屋 美恵子'
    );
    expect(extractPatientNameFromProjectTitle(null)).toBeNull();
  });

  it('matches patient identity against MCS candidate names and kana', () => {
    expect(
      matchesPatientIdentity(
        { name: '板屋 美恵子', name_kana: 'イタヤ ミエコ' },
        ['板屋 美恵子', '年長者の里']
      )
    ).toBe(true);

    expect(
      matchesPatientIdentity(
        { name: '板屋 美恵子', name_kana: 'イタヤ ミエコ' },
        ['別患者', 'ベツカンジャ']
      )
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
      })
    ).resolves.toMatchObject({
      generation_id: 'gen_1',
      provider: 'rule',
    });
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
        'spawn agent-browser ENOENT while connecting to Chrome'
      )
    ).toBe(
      'MCS 連携用ブラウザに接続できません。ローカル端末で MCS にログインした Chrome を開いてから再試行してください。'
    );

    expect(
      sanitizePatientMcsExternalErrorMessage(
        'Medical Care Station にログイン済みの Chrome セッションが見つかりません'
      )
    ).toBe('Medical Care Station にログイン済みの Chrome セッションが見つかりません');
  });
});
