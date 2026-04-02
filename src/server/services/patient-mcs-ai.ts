export type PatientMcsSummaryMessage = {
  sourceMessageId: string;
  authorName: string;
  authorRole: string | null;
  authorOrganization: string | null;
  postedAt: Date | null;
  postedAtLabel: string;
  body: string;
};

type PatientMcsSummaryInput = {
  patientName: string;
  projectTitle: string | null;
  messages: PatientMcsSummaryMessage[];
};

export type PatientMcsSummarySnapshot = {
  generation_id: string;
  provider: 'openai' | 'rule';
  requested_provider: string;
  is_fallback: boolean;
  model: string | null;
  fallback_reason: string | null;
  headline: string;
  bullets: string[];
  must_check_today: string[];
  suggested_actions: string[];
  source_refs: string[];
  message_count: number;
  other_professional_message_count: number;
  latest_posted_at: string | null;
  generated_at: string;
  duration_ms: number | null;
};

type OpenAiSummaryPayload = {
  headline?: unknown;
  bullets?: unknown;
  must_check_today?: unknown;
  suggested_actions?: unknown;
};

const ACTION_PATTERN =
  /(依頼|確認|相談|お願い|至急|受診|連絡|共有|報告|調整|予約|訪問|折返し|再確認)/;
const MUST_CHECK_PATTERN =
  /(発熱|疼痛|痛み|血圧|脈拍|浮腫|転倒|食欲|睡眠|便秘|下痢|むくみ|服薬|眠気|SpO2|酸素|咳|痰|不穏|脱水|感染)/i;
const DEFAULT_ALLOWED_AI_HOSTS = new Set(['api.openai.com']);

function toStringArray(value: unknown, maxItems: number) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .slice(0, maxItems);
}

function uniqueStrings(items: string[], maxItems: number) {
  return [...new Set(items.map((item) => item.trim()).filter(Boolean))].slice(0, maxItems);
}

function shouldAllowExternalAi() {
  return process.env.PATIENT_MCS_AI_ALLOW_EXTERNAL === 'true';
}

function isAllowedAiEndpoint(endpoint: string) {
  try {
    const parsed = new URL(endpoint);
    const allowedHosts = new Set([
      ...DEFAULT_ALLOWED_AI_HOSTS,
      ...(process.env.PATIENT_MCS_AI_ALLOWED_HOSTS ?? '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
    ]);
    return parsed.protocol === 'https:' && allowedHosts.has(parsed.hostname);
  } catch {
    return false;
  }
}

function isOtherProfessionalRole(role: string | null) {
  if (!role) return true;
  return !/薬剤師/.test(role);
}

function summarizeBody(body: string, maxLength = 70) {
  const normalized = body.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1)}…`;
}

function anonymizeForExternalAi(text: string, patientName: string) {
  return text
    .replaceAll(patientName, '患者')
    .replace(/\b\d{7,}\b/g, '[ID]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[EMAIL]');
}

function buildSourceRef(message: PatientMcsSummaryMessage) {
  const actor = message.authorRole ?? message.authorName;
  return `${message.postedAtLabel} ${actor}`.trim();
}

function orderMessagesByRecency(messages: PatientMcsSummaryMessage[]) {
  return [...messages].sort((left, right) => {
    const leftTime = left.postedAt?.getTime() ?? Number.MIN_SAFE_INTEGER;
    const rightTime = right.postedAt?.getTime() ?? Number.MIN_SAFE_INTEGER;
    if (leftTime !== rightTime) {
      return rightTime - leftTime;
    }

    return right.sourceMessageId.localeCompare(left.sourceMessageId);
  });
}

function buildMessageSummaryLine(message: PatientMcsSummaryMessage) {
  const actor = message.authorRole
    ? `${message.authorRole}${message.authorOrganization ? `(${message.authorOrganization})` : ''}`
    : message.authorName;
  return `${message.postedAtLabel} ${actor}: ${summarizeBody(message.body, 64)}`;
}

function buildFallbackSummary(input: PatientMcsSummaryInput): PatientMcsSummarySnapshot {
  const generationId = globalThis.crypto?.randomUUID?.() ?? `mcs_${Date.now()}`;
  const ordered = orderMessagesByRecency(input.messages);
  const otherProfessional = ordered.filter((message) => isOtherProfessionalRole(message.authorRole));
  const sourceMessages = otherProfessional;
  const latestMessage = sourceMessages[0] ?? null;
  const fallbackReason =
    input.messages.length > 0 && otherProfessional.length === 0
      ? 'no_other_professional_messages'
      : 'provider_unavailable';
  const headline =
    sourceMessages.length === 0
      ? '他職種からの共有はまだ取り込まれていません。'
      : latestMessage
        ? `${sourceMessages.length}件の共有を取り込みました。直近は${latestMessage.authorRole ?? latestMessage.authorName}からの投稿です。`
        : '他職種からの共有を取り込みました。';

  const bullets = uniqueStrings(
    sourceMessages.slice(0, 3).map((message) => buildMessageSummaryLine(message)),
    3
  );
  const mustCheckToday = uniqueStrings(
    sourceMessages
      .filter((message) => MUST_CHECK_PATTERN.test(message.body))
      .slice(0, 4)
      .map((message) => buildMessageSummaryLine(message)),
    4
  );
  const suggestedActions = uniqueStrings(
    sourceMessages
      .filter((message) => ACTION_PATTERN.test(message.body))
      .slice(0, 4)
      .map((message) => buildMessageSummaryLine(message)),
    4
  );
  const latestPostedAt = sourceMessages
    .map((message) => message.postedAt)
    .filter((value): value is Date => value instanceof Date)
    .sort((left, right) => right.getTime() - left.getTime())[0];

  return {
    generation_id: generationId,
    provider: 'rule',
    requested_provider: process.env.PATIENT_MCS_AI_PROVIDER ?? 'disabled',
    is_fallback: true,
    model: null,
    fallback_reason: fallbackReason,
    headline,
    bullets,
    must_check_today: mustCheckToday,
    suggested_actions: suggestedActions,
    source_refs: uniqueStrings(sourceMessages.slice(0, 6).map((message) => buildSourceRef(message)), 6),
    message_count: input.messages.length,
    other_professional_message_count: otherProfessional.length,
    latest_posted_at: latestPostedAt?.toISOString() ?? null,
    generated_at: new Date().toISOString(),
    duration_ms: null,
  };
}

export async function generatePatientMcsAiSummary(
  input: PatientMcsSummaryInput
): Promise<PatientMcsSummarySnapshot> {
  const apiKey = process.env.PATIENT_MCS_AI_API_KEY;
  const provider =
    process.env.PATIENT_MCS_AI_PROVIDER ??
    (apiKey && shouldAllowExternalAi() ? 'openai' : 'disabled');
  const startedAt = Date.now();
  const generationId = globalThis.crypto?.randomUUID?.() ?? `mcs_${startedAt}`;
  const fallback = buildFallbackSummary(input);
  const otherProfessionalMessages = input.messages.filter((message) =>
    isOtherProfessionalRole(message.authorRole)
  );

  if (otherProfessionalMessages.length === 0) {
    return {
      ...fallback,
      generation_id: generationId,
      requested_provider: provider,
      fallback_reason: 'no_other_professional_messages',
    };
  }

  if (!apiKey || provider !== 'openai') {
    return {
      ...fallback,
      generation_id: generationId,
      requested_provider: provider,
    };
  }

  const orderedSourceMessages = orderMessagesByRecency(otherProfessionalMessages).slice(0, 12);
  const endpoint =
    process.env.PATIENT_MCS_AI_BASE_URL ?? 'https://api.openai.com/v1/chat/completions';
  const model = process.env.PATIENT_MCS_AI_MODEL ?? 'gpt-5-mini';
  const timeoutMs = Number(process.env.PATIENT_MCS_AI_TIMEOUT_MS ?? 4000);

  if (!isAllowedAiEndpoint(endpoint)) {
    return {
      ...fallback,
      generation_id: generationId,
      requested_provider: provider,
      fallback_reason: 'endpoint_not_allowed',
    };
  }

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        max_completion_tokens: 500,
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'patient_mcs_summary',
            strict: true,
            schema: {
              type: 'object',
              properties: {
                headline: { type: 'string' },
                bullets: {
                  type: 'array',
                  items: { type: 'string' },
                  maxItems: 3,
                },
                must_check_today: {
                  type: 'array',
                  items: { type: 'string' },
                  maxItems: 4,
                },
                suggested_actions: {
                  type: 'array',
                  items: { type: 'string' },
                  maxItems: 4,
                },
              },
              required: ['headline', 'bullets', 'must_check_today', 'suggested_actions'],
              additionalProperties: false,
            },
          },
        },
        messages: [
          {
            role: 'system',
            content:
              'あなたは在宅医療の多職種連携要約支援です。与えられた投稿事実だけを使い、診断や投薬判断を追加せず、業務上の共有・確認事項・次アクションだけを簡潔にまとめてください。',
          },
          {
            role: 'user',
            content: JSON.stringify({
              patient_name: '患者',
              project_title: input.projectTitle,
              messages: orderedSourceMessages.map((message) => ({
                source_message_id: message.sourceMessageId,
                author_role: message.authorRole,
                posted_at_label: message.postedAtLabel,
                body: anonymizeForExternalAi(message.body, input.patientName),
              })),
            }),
          },
        ],
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!response.ok) {
      console.warn('[patient-mcs-ai] fallback', {
        provider,
        model,
        reason: 'upstream_error',
        status: response.status,
        duration_ms: Date.now() - startedAt,
      });
      return {
        ...fallback,
        generation_id: generationId,
        requested_provider: provider,
        model,
        fallback_reason: 'upstream_error',
        duration_ms: Date.now() - startedAt,
      };
    }

    const payload = (await response.json()) as {
      choices?: Array<{
        message?: {
          content?: string | null;
        };
      }>;
    };

    const raw = payload.choices?.[0]?.message?.content;
    if (!raw) {
      console.warn('[patient-mcs-ai] fallback', {
        provider,
        model,
        reason: 'empty_response',
        duration_ms: Date.now() - startedAt,
      });
      return {
        ...fallback,
        generation_id: generationId,
        requested_provider: provider,
        model,
        fallback_reason: 'empty_response',
        duration_ms: Date.now() - startedAt,
      };
    }

    const parsed = JSON.parse(raw) as OpenAiSummaryPayload;
    const headline =
      typeof parsed.headline === 'string' && parsed.headline.trim().length > 0
        ? parsed.headline.trim()
        : fallback.headline;
    const bullets = toStringArray(parsed.bullets, 3);
    const mustCheckToday = toStringArray(parsed.must_check_today, 4);
    const suggestedActions = toStringArray(parsed.suggested_actions, 4);

    return {
      generation_id: generationId,
      provider: 'openai',
      requested_provider: provider,
      is_fallback: false,
      model,
      fallback_reason: null,
      headline,
      bullets: bullets.length > 0 ? bullets : fallback.bullets,
      must_check_today:
        mustCheckToday.length > 0 ? mustCheckToday : fallback.must_check_today,
      suggested_actions:
        suggestedActions.length > 0 ? suggestedActions : fallback.suggested_actions,
      source_refs: fallback.source_refs,
      message_count: fallback.message_count,
      other_professional_message_count: fallback.other_professional_message_count,
      latest_posted_at: fallback.latest_posted_at,
      generated_at: new Date().toISOString(),
      duration_ms: Date.now() - startedAt,
    };
  } catch (error) {
    console.warn('[patient-mcs-ai] fallback', {
      provider,
      model,
      reason: error instanceof Error ? error.message : 'unknown_error',
      duration_ms: Date.now() - startedAt,
    });
    return {
      ...fallback,
      generation_id: generationId,
      requested_provider: provider,
      model,
      fallback_reason: error instanceof Error ? error.message : 'unknown_error',
      duration_ms: Date.now() - startedAt,
    };
  }
}
