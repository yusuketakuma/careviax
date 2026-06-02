import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { extractHandoffFromSoap, generateVisitBriefAiSummary } from './visit-brief-ai';

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
    timeoutMs: process.env.VISIT_BRIEF_AI_TIMEOUT_MS,
  };
  const originalFetch = global.fetch;

  beforeEach(() => {
    delete process.env.VISIT_BRIEF_AI_PROVIDER;
    delete process.env.VISIT_BRIEF_AI_API_KEY;
    delete process.env.VISIT_BRIEF_AI_BASE_URL;
    delete process.env.VISIT_BRIEF_AI_MODEL;
    delete process.env.VISIT_BRIEF_AI_TIMEOUT_MS;
    vi.restoreAllMocks();
  });

  afterEach(() => {
    process.env.VISIT_BRIEF_AI_PROVIDER = originalEnv.provider;
    process.env.VISIT_BRIEF_AI_API_KEY = originalEnv.apiKey;
    process.env.VISIT_BRIEF_AI_BASE_URL = originalEnv.baseUrl;
    process.env.VISIT_BRIEF_AI_MODEL = originalEnv.model;
    process.env.VISIT_BRIEF_AI_TIMEOUT_MS = originalEnv.timeoutMs;
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

  it('uses the default AI timeout when the configured timeout is non-finite', async () => {
    process.env.VISIT_BRIEF_AI_PROVIDER = 'openai';
    process.env.VISIT_BRIEF_AI_API_KEY = 'test-key';
    process.env.VISIT_BRIEF_AI_TIMEOUT_MS = 'Infinity';
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout');
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                headline: '眠気とふらつき確認が最優先です。',
                bullets: ['処方変更: アムロジピン減量'],
                must_check_today: ['残薬確認'],
              }),
            },
          },
        ],
      }),
    } as Response);

    const result = await generateVisitBriefAiSummary(input);

    expect(timeoutSpy).toHaveBeenCalledWith(3500);
    expect(result).toMatchObject({
      provider: 'openai',
      is_fallback: false,
    });
  });

  it('falls back when the AI response content is not a JSON object', async () => {
    process.env.VISIT_BRIEF_AI_PROVIDER = 'openai';
    process.env.VISIT_BRIEF_AI_API_KEY = 'test-key';
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify(['unexpected']),
            },
          },
        ],
      }),
    } as Response);

    const result = await generateVisitBriefAiSummary(input);

    expect(result).toMatchObject({
      provider: 'rule',
      requested_provider: 'openai',
      is_fallback: true,
      model: 'gpt-5-mini',
      fallback_reason: 'invalid_response',
      headline: '直近処方で 1 件の変更があります。',
    });
  });

  it('falls back when the AI response content is malformed JSON text', async () => {
    process.env.VISIT_BRIEF_AI_PROVIDER = 'openai';
    process.env.VISIT_BRIEF_AI_API_KEY = 'test-key';
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: 'not-json',
            },
          },
        ],
      }),
    } as Response);

    const result = await generateVisitBriefAiSummary(input);

    expect(result).toMatchObject({
      provider: 'rule',
      requested_provider: 'openai',
      is_fallback: true,
      model: 'gpt-5-mini',
      fallback_reason: 'invalid_response',
      headline: '直近処方で 1 件の変更があります。',
    });
  });

  it('falls back with invalid_response when the AI response envelope is malformed', async () => {
    process.env.VISIT_BRIEF_AI_PROVIDER = 'openai';
    process.env.VISIT_BRIEF_AI_API_KEY = 'test-key';
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: {
          message: {
            content: JSON.stringify({
              headline: 'bad envelope',
              bullets: [],
              must_check_today: [],
            }),
          },
        },
      }),
    } as Response);

    const result = await generateVisitBriefAiSummary(input);

    expect(result).toMatchObject({
      provider: 'rule',
      requested_provider: 'openai',
      is_fallback: true,
      model: 'gpt-5-mini',
      fallback_reason: 'invalid_response',
      headline: '直近処方で 1 件の変更があります。',
    });
  });

  it('falls back with invalid_response when the AI response body is invalid JSON', async () => {
    process.env.VISIT_BRIEF_AI_PROVIDER = 'openai';
    process.env.VISIT_BRIEF_AI_API_KEY = 'test-key';
    global.fetch = vi.fn().mockResolvedValue(
      new Response('not-json', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const result = await generateVisitBriefAiSummary(input);

    expect(result).toMatchObject({
      provider: 'rule',
      requested_provider: 'openai',
      is_fallback: true,
      model: 'gpt-5-mini',
      fallback_reason: 'invalid_response',
      headline: '直近処方で 1 件の変更があります。',
    });
  });

  it('extracts handoff items only from object-shaped structured SOAP fields', async () => {
    const result = await extractHandoffFromSoap({
      patientName: '患者A',
      soapAssessment: '血圧変動あり',
      soapPlan: '次回訪問で血圧とふらつきを確認',
      structuredAssessment: { issues: ['血圧変動', 123, ''] },
      structuredPlan: {
        followup_items: ['残薬確認', 123, '  ふらつき確認  '],
        monitoring_items: ['血圧', null, '眠気'],
        rationale: '  降圧薬変更後のため  ',
      },
      previousHandoff: { ongoing_monitoring: ['前回メモ'] },
    });

    expect(result).toMatchObject({
      next_check_items: ['残薬確認', 'ふらつき確認'],
      ongoing_monitoring: ['血圧', '眠気'],
      decision_rationale: '降圧薬変更後のため',
      confidence: 0.7,
    });
  });

  it('ignores malformed structured SOAP roots and falls back to SOAP plan text', async () => {
    const result = await extractHandoffFromSoap({
      patientName: '患者A',
      soapAssessment: '血圧変動あり',
      soapPlan: '次回訪問で血圧とふらつきを確認',
      structuredAssessment: ['血圧変動'],
      structuredPlan: ['残薬確認'],
      previousHandoff: '前回メモ',
    });

    expect(result).toMatchObject({
      next_check_items: ['次回訪問で血圧とふらつきを確認'],
      ongoing_monitoring: [],
      decision_rationale: null,
      confidence: 0.7,
    });
  });
});
