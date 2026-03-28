import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateVisitBriefAiSummary } from './visit-brief-ai';

const input = {
  patientName: '患者A',
  context: 'patient' as const,
  medicationChanges: ['アムロジピン / dose_changed / 2.5mg / 朝1回'],
  dispensing: ['方法: 一包化 / セット: 施設カレンダー'],
  multidisciplinary: ['自己申告 眠気 / 家族よりふらつきあり'],
  unresolved: ['疑義照会 / 減量提案待ち'],
  mustCheckToday: ['直近の処方変更内容と残薬の整合'],
  fallbackHeadline: '直近処方で 1 件の変更があります。',
  fallbackBullets: ['処方変更: アムロジピン 5mg → 2.5mg'],
  sourceRefs: ['処方履歴', '調剤方法・セット計画'],
};

describe('visit-brief-ai', () => {
  const originalEnv = {
    provider: process.env.VISIT_BRIEF_AI_PROVIDER,
    apiKey: process.env.VISIT_BRIEF_AI_API_KEY,
    baseUrl: process.env.VISIT_BRIEF_AI_BASE_URL,
    model: process.env.VISIT_BRIEF_AI_MODEL,
  };
  const originalFetch = global.fetch;

  beforeEach(() => {
    delete process.env.VISIT_BRIEF_AI_PROVIDER;
    delete process.env.VISIT_BRIEF_AI_API_KEY;
    delete process.env.VISIT_BRIEF_AI_BASE_URL;
    delete process.env.VISIT_BRIEF_AI_MODEL;
    vi.restoreAllMocks();
  });

  afterEach(() => {
    process.env.VISIT_BRIEF_AI_PROVIDER = originalEnv.provider;
    process.env.VISIT_BRIEF_AI_API_KEY = originalEnv.apiKey;
    process.env.VISIT_BRIEF_AI_BASE_URL = originalEnv.baseUrl;
    process.env.VISIT_BRIEF_AI_MODEL = originalEnv.model;
    global.fetch = originalFetch;
  });

  it('falls back to rule summary when AI is not configured', async () => {
    const result = await generateVisitBriefAiSummary(input);

    expect(result).toMatchObject({
      provider: 'rule',
      requested_provider: 'disabled',
      is_fallback: true,
      model: null,
      fallback_reason: 'provider_unavailable',
      headline: '直近処方で 1 件の変更があります。',
      bullets: ['処方変更: アムロジピン 5mg → 2.5mg'],
    });
  });

  it('uses OpenAI-compatible endpoint when configured', async () => {
    process.env.VISIT_BRIEF_AI_PROVIDER = 'openai';
    process.env.VISIT_BRIEF_AI_API_KEY = 'test-key';
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                headline: '眠気とふらつき確認が最優先です。',
                bullets: ['処方変更: アムロジピン減量', '調剤方法: 朝夕一包化'],
                must_check_today: ['残薬確認', 'ふらつき確認'],
              }),
            },
          },
        ],
      }),
    } as Response);

    const result = await generateVisitBriefAiSummary(input);

    expect(global.fetch).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      provider: 'openai',
      requested_provider: 'openai',
      is_fallback: false,
      model: 'gpt-5-mini',
      fallback_reason: null,
      headline: '眠気とふらつき確認が最優先です。',
      bullets: ['処方変更: アムロジピン減量', '調剤方法: 朝夕一包化'],
      must_check_today: ['残薬確認', 'ふらつき確認'],
    });
  });
});
