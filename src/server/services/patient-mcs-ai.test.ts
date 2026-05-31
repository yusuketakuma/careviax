import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generatePatientMcsAiSummary } from './patient-mcs-ai';

describe('patient-mcs-ai', () => {
  const originalEnv = {
    apiKey: process.env.PATIENT_MCS_AI_API_KEY,
    provider: process.env.PATIENT_MCS_AI_PROVIDER,
    allowExternal: process.env.PATIENT_MCS_AI_ALLOW_EXTERNAL,
    allowedHosts: process.env.PATIENT_MCS_AI_ALLOWED_HOSTS,
    baseUrl: process.env.PATIENT_MCS_AI_BASE_URL,
    model: process.env.PATIENT_MCS_AI_MODEL,
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    delete process.env.PATIENT_MCS_AI_API_KEY;
    delete process.env.PATIENT_MCS_AI_PROVIDER;
    delete process.env.PATIENT_MCS_AI_ALLOW_EXTERNAL;
    delete process.env.PATIENT_MCS_AI_ALLOWED_HOSTS;
    delete process.env.PATIENT_MCS_AI_BASE_URL;
    delete process.env.PATIENT_MCS_AI_MODEL;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    process.env.PATIENT_MCS_AI_API_KEY = originalEnv.apiKey;
    process.env.PATIENT_MCS_AI_PROVIDER = originalEnv.provider;
    process.env.PATIENT_MCS_AI_ALLOW_EXTERNAL = originalEnv.allowExternal;
    process.env.PATIENT_MCS_AI_ALLOWED_HOSTS = originalEnv.allowedHosts;
    process.env.PATIENT_MCS_AI_BASE_URL = originalEnv.baseUrl;
    process.env.PATIENT_MCS_AI_MODEL = originalEnv.model;
  });

  it('falls back to a rule summary when AI is not configured', async () => {
    const summary = await generatePatientMcsAiSummary({
      patientName: '青葉 花子',
      projectTitle: '青葉 花子：年長者の里',
      messages: [
        {
          sourceMessageId: 'message_2',
          authorName: '青木 健',
          authorRole: 'ケアマネジャー',
          authorOrganization: '居宅介護支援',
          postedAt: new Date('2026-04-02T09:00:00.000Z'),
          postedAtLabel: '4/2 18:00',
          body: '家族へ折返し連絡予定です。',
        },
        {
          sourceMessageId: 'message_1',
          authorName: '篠原 陽子',
          authorRole: '看護師',
          authorOrganization: '年長者の里訪問看護ステーション',
          postedAt: new Date('2026-04-02T08:00:00.000Z'),
          postedAtLabel: '4/2 17:00',
          body: '食欲低下が続いています。次回訪問時に水分摂取量も確認をお願いします。',
        },
      ],
    });

    expect(summary.provider).toBe('rule');
    expect(summary.is_fallback).toBe(true);
    expect(summary.other_professional_message_count).toBe(2);
    expect(summary.suggested_actions.join(' ')).toContain('折返し');
  });

  it('returns an explicit no-message summary when there are no scraped posts', async () => {
    const summary = await generatePatientMcsAiSummary({
      patientName: '青葉 花子',
      projectTitle: '青葉 花子：年長者の里',
      messages: [],
    });

    expect(summary.provider).toBe('rule');
    expect(summary.headline).toContain('まだ取り込まれていません');
    expect(summary.message_count).toBe(0);
  });

  it('returns a structured AI summary when the provider is configured', async () => {
    process.env.PATIENT_MCS_AI_API_KEY = 'test-key';
    process.env.PATIENT_MCS_AI_PROVIDER = 'openai';
    process.env.PATIENT_MCS_AI_ALLOW_EXTERNAL = 'true';
    process.env.PATIENT_MCS_AI_BASE_URL = 'https://example.test/v1/chat/completions';
    process.env.PATIENT_MCS_AI_ALLOWED_HOSTS = 'example.test';
    process.env.PATIENT_MCS_AI_MODEL = 'gpt-5-mini';

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                headline: '看護師とケアマネから重要共有があります。',
                bullets: ['食欲低下が続いています。'],
                must_check_today: ['脱水兆候の推移を確認してください。'],
                suggested_actions: ['次回訪問時に水分摂取量を確認してください。'],
              }),
            },
          },
        ],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const summary = await generatePatientMcsAiSummary({
      patientName: '青葉 花子',
      projectTitle: '青葉 花子：年長者の里',
      messages: [
        {
          sourceMessageId: 'message_2',
          authorName: '青木 健',
          authorRole: 'ケアマネジャー',
          authorOrganization: '居宅介護支援',
          postedAt: new Date('2026-04-02T09:00:00.000Z'),
          postedAtLabel: '4/2 18:00',
          body: '家族へ折返し連絡予定です。',
        },
        {
          sourceMessageId: 'message_1',
          authorName: '篠原 陽子',
          authorRole: '看護師',
          authorOrganization: '年長者の里訪問看護ステーション',
          postedAt: new Date('2026-04-02T08:00:00.000Z'),
          postedAtLabel: '4/2 17:00',
          body: '食欲低下が続いています。次回訪問時に水分摂取量も確認をお願いします。',
        },
      ],
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const requestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    const userPayload = JSON.parse(requestBody.messages[1].content);
    expect(userPayload.patient_name).toBe('患者');
    expect(userPayload.messages[0]?.source_message_id).toBe('message_2');
    expect(userPayload.messages[0]).not.toHaveProperty('author_name');
    expect(userPayload.messages[0]).not.toHaveProperty('author_organization');
    expect(userPayload.messages[0]?.author_role).toBe('ケアマネジャー');
    expect(summary.provider).toBe('openai');
    expect(summary.is_fallback).toBe(false);
    expect(summary.headline).toBe('看護師とケアマネから重要共有があります。');
    expect(summary.suggested_actions).toEqual(['次回訪問時に水分摂取量を確認してください。']);
  });

  it('selects the latest 12 messages before sending the AI request', async () => {
    process.env.PATIENT_MCS_AI_API_KEY = 'test-key';
    process.env.PATIENT_MCS_AI_PROVIDER = 'openai';
    process.env.PATIENT_MCS_AI_ALLOW_EXTERNAL = 'true';

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                headline: '最新共有を要約しました。',
                bullets: ['最新共有'],
                must_check_today: [],
                suggested_actions: [],
              }),
            },
          },
        ],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await generatePatientMcsAiSummary({
      patientName: '青葉 花子',
      projectTitle: '青葉 花子：年長者の里',
      messages: Array.from({ length: 13 }, (_, index) => ({
        sourceMessageId: `message_${index + 1}`,
        authorName: `担当${index + 1}`,
        authorRole: '看護師',
        authorOrganization: '訪問看護',
        postedAt: new Date(`2026-04-${String(index + 1).padStart(2, '0')}T08:00:00.000Z`),
        postedAtLabel: `4/${index + 1} 17:00`,
        body: `共有 ${index + 1}`,
      })),
    });

    const requestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    const userPayload = JSON.parse(requestBody.messages[1].content);
    expect(userPayload.messages).toHaveLength(12);
    expect(userPayload.messages[0]?.source_message_id).toBe('message_13');
    expect(userPayload.messages.at(-1)?.source_message_id).toBe('message_2');
  });

  it('skips the AI call when only pharmacist-originated messages are present', async () => {
    process.env.PATIENT_MCS_AI_API_KEY = 'test-key';
    process.env.PATIENT_MCS_AI_PROVIDER = 'openai';
    process.env.PATIENT_MCS_AI_ALLOW_EXTERNAL = 'true';

    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const summary = await generatePatientMcsAiSummary({
      patientName: '青葉 花子',
      projectTitle: '青葉 花子：年長者の里',
      messages: [
        {
          sourceMessageId: 'message_1',
          authorName: '薬剤師 花子',
          authorRole: '薬剤師',
          authorOrganization: 'CareVia薬局',
          postedAt: new Date('2026-04-02T08:00:00.000Z'),
          postedAtLabel: '4/2 17:00',
          body: '薬局側からの確認です。',
        },
      ],
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(summary.provider).toBe('rule');
    expect(summary.fallback_reason).toBe('no_other_professional_messages');
  });

  it('keeps model metadata when the upstream AI call fails', async () => {
    process.env.PATIENT_MCS_AI_API_KEY = 'test-key';
    process.env.PATIENT_MCS_AI_PROVIDER = 'openai';
    process.env.PATIENT_MCS_AI_ALLOW_EXTERNAL = 'true';
    process.env.PATIENT_MCS_AI_MODEL = 'gpt-5-mini';

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
      }),
    );

    const summary = await generatePatientMcsAiSummary({
      patientName: '青葉 花子',
      projectTitle: '青葉 花子：年長者の里',
      messages: [
        {
          sourceMessageId: 'message_1',
          authorName: '篠原 陽子',
          authorRole: '看護師',
          authorOrganization: '訪問看護',
          postedAt: new Date('2026-04-02T08:00:00.000Z'),
          postedAtLabel: '4/2 17:00',
          body: '食欲低下が続いています。',
        },
      ],
    });

    expect(summary.provider).toBe('rule');
    expect(summary.model).toBe('gpt-5-mini');
    expect(summary.fallback_reason).toBe('upstream_error');
    expect(summary.duration_ms).not.toBeNull();
  });

  it('falls back when the AI response content is not a JSON object', async () => {
    process.env.PATIENT_MCS_AI_API_KEY = 'test-key';
    process.env.PATIENT_MCS_AI_PROVIDER = 'openai';
    process.env.PATIENT_MCS_AI_ALLOW_EXTERNAL = 'true';
    process.env.PATIENT_MCS_AI_MODEL = 'gpt-5-mini';

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
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
      }),
    );

    const summary = await generatePatientMcsAiSummary({
      patientName: '青葉 花子',
      projectTitle: '青葉 花子：年長者の里',
      messages: [
        {
          sourceMessageId: 'message_1',
          authorName: '篠原 陽子',
          authorRole: '看護師',
          authorOrganization: '訪問看護',
          postedAt: new Date('2026-04-02T08:00:00.000Z'),
          postedAtLabel: '4/2 17:00',
          body: '食欲低下が続いています。',
        },
      ],
    });

    expect(summary.provider).toBe('rule');
    expect(summary.model).toBe('gpt-5-mini');
    expect(summary.fallback_reason).toBe('invalid_response');
    expect(summary.headline).toContain('1件の共有を取り込みました');
  });

  it('falls back with invalid_response when the AI response envelope is malformed', async () => {
    process.env.PATIENT_MCS_AI_API_KEY = 'test-key';
    process.env.PATIENT_MCS_AI_PROVIDER = 'openai';
    process.env.PATIENT_MCS_AI_ALLOW_EXTERNAL = 'true';
    process.env.PATIENT_MCS_AI_MODEL = 'gpt-5-mini';

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: {
            message: {
              content: JSON.stringify({
                headline: 'bad envelope',
                bullets: [],
                must_check_today: [],
                suggested_actions: [],
              }),
            },
          },
        }),
      }),
    );

    const summary = await generatePatientMcsAiSummary({
      patientName: '青葉 花子',
      projectTitle: '青葉 花子：年長者の里',
      messages: [
        {
          sourceMessageId: 'message_1',
          authorName: '篠原 陽子',
          authorRole: '看護師',
          authorOrganization: '訪問看護',
          postedAt: new Date('2026-04-02T08:00:00.000Z'),
          postedAtLabel: '4/2 17:00',
          body: '食欲低下が続いています。',
        },
      ],
    });

    expect(summary.provider).toBe('rule');
    expect(summary.model).toBe('gpt-5-mini');
    expect(summary.fallback_reason).toBe('invalid_response');
    expect(summary.headline).toContain('1件の共有を取り込みました');
  });

  it('keeps external AI disabled unless explicit opt-in is enabled', async () => {
    process.env.PATIENT_MCS_AI_API_KEY = 'test-key';
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const summary = await generatePatientMcsAiSummary({
      patientName: '青葉 花子',
      projectTitle: '青葉 花子：年長者の里',
      messages: [
        {
          sourceMessageId: 'message_1',
          authorName: '篠原 陽子',
          authorRole: '看護師',
          authorOrganization: '訪問看護',
          postedAt: new Date('2026-04-02T08:00:00.000Z'),
          postedAtLabel: '4/2 17:00',
          body: '食欲低下が続いています。',
        },
      ],
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(summary.provider).toBe('rule');
    expect(summary.fallback_reason).toBe('provider_unavailable');
  });
});
