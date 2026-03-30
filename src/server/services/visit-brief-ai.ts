import type { VisitBriefAiSummary } from '@/types/visit-brief';

type VisitBriefAiInput = {
  patientName: string;
  context: 'patient' | 'schedule';
  medicationChanges: string[];
  dispensing: string[];
  multidisciplinary: string[];
  unresolved: string[];
  mustCheckToday: string[];
  fallbackHeadline: string;
  fallbackBullets: string[];
  sourceRefs: string[];
};

type OpenAiSummaryPayload = {
  headline?: unknown;
  bullets?: unknown;
  must_check_today?: unknown;
};

function toStringArray(value: unknown, maxItems: number) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .slice(0, maxItems);
}

function buildFallbackSummary(input: VisitBriefAiInput): VisitBriefAiSummary {
  const generationId = globalThis.crypto?.randomUUID?.() ?? `brief_${Date.now()}`;
  return {
    generation_id: generationId,
    provider: 'rule',
    requested_provider: process.env.VISIT_BRIEF_AI_PROVIDER ?? 'disabled',
    is_fallback: true,
    model: null,
    fallback_reason: 'provider_unavailable',
    headline: input.fallbackHeadline,
    bullets: input.fallbackBullets.slice(0, 3),
    must_check_today: input.mustCheckToday.slice(0, 4),
    source_refs: input.sourceRefs.slice(0, 6),
    generated_at: new Date().toISOString(),
    duration_ms: null,
    recent_generation_count_24h: 0,
    recent_failure_count_24h: 0,
    recent_failure_rate_24h: null,
  };
}

export async function generateVisitBriefAiSummary(
  input: VisitBriefAiInput
): Promise<VisitBriefAiSummary> {
  const apiKey = process.env.VISIT_BRIEF_AI_API_KEY;
  const provider = process.env.VISIT_BRIEF_AI_PROVIDER ?? (apiKey ? 'openai' : 'disabled');
  const startedAt = Date.now();
  const generationId = globalThis.crypto?.randomUUID?.() ?? `brief_${startedAt}`;

  if (!apiKey || provider !== 'openai') {
    return {
      ...buildFallbackSummary(input),
      generation_id: generationId,
    };
  }

  const endpoint =
    process.env.VISIT_BRIEF_AI_BASE_URL ??
    'https://api.openai.com/v1/chat/completions';
  const model = process.env.VISIT_BRIEF_AI_MODEL ?? 'gpt-5-mini';
  const timeoutMs = Number(process.env.VISIT_BRIEF_AI_TIMEOUT_MS ?? 3500);

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
        max_completion_tokens: 400,
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'visit_brief_summary',
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
              },
              required: ['headline', 'bullets', 'must_check_today'],
              additionalProperties: false,
            },
          },
        },
        messages: [
          {
            role: 'system',
            content:
              'あなたは在宅訪問薬剤管理の要約支援です。入力事実だけを使い、断定診断や新規の医療判断を行わず、短く端的にまとめてください。',
          },
          {
            role: 'user',
            content: JSON.stringify(input),
          },
        ],
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!response.ok) {
      console.warn('[visit-brief-ai] fallback', {
        provider,
        model,
        reason: 'upstream_error',
        status: response.status,
        duration_ms: Date.now() - startedAt,
      });
      return buildFallbackSummary(input);
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
      console.warn('[visit-brief-ai] fallback', {
        provider,
        model,
        reason: 'empty_response',
        duration_ms: Date.now() - startedAt,
      });
      return buildFallbackSummary(input);
    }

    const parsed = JSON.parse(raw) as OpenAiSummaryPayload;
    const headline =
      typeof parsed.headline === 'string' && parsed.headline.trim().length > 0
        ? parsed.headline.trim()
        : input.fallbackHeadline;

    const bullets = toStringArray(parsed.bullets, 3);
    const mustCheckToday = toStringArray(parsed.must_check_today, 4);

    return {
      generation_id: generationId,
      provider: 'openai',
      requested_provider: provider,
      is_fallback: false,
      model,
      fallback_reason: null,
      headline,
      bullets: bullets.length > 0 ? bullets : input.fallbackBullets.slice(0, 3),
      must_check_today:
        mustCheckToday.length > 0 ? mustCheckToday : input.mustCheckToday.slice(0, 4),
      source_refs: input.sourceRefs.slice(0, 6),
      generated_at: new Date().toISOString(),
      duration_ms: Date.now() - startedAt,
      recent_generation_count_24h: 0,
      recent_failure_count_24h: 0,
      recent_failure_rate_24h: null,
    };
  } catch (error) {
    console.warn('[visit-brief-ai] fallback', {
      provider,
      model,
      reason: error instanceof Error ? error.message : 'unknown_error',
      duration_ms: Date.now() - startedAt,
    });
    const fallback = buildFallbackSummary(input);
    return {
      ...fallback,
      generation_id: generationId,
      requested_provider: provider,
      fallback_reason: error instanceof Error ? error.message : 'unknown_error',
    };
  }
}

// ─── extractHandoffFromSoap ─────────────────────────────────────────────────

type ExtractHandoffInput = {
  patientName: string;
  soapAssessment: string;
  soapPlan: string;
  structuredAssessment: unknown;
  structuredPlan: unknown;
  previousHandoff: unknown;
};

type ExtractHandoffResult = {
  next_check_items: string[];
  ongoing_monitoring: string[];
  decision_rationale: string | null;
  confidence: number;
  extracted_at: string;
};

/**
 * Extract handoff data from structured SOAP notes.
 * Rule-based extraction — pulls items from structured assessment/plan fields.
 */
export async function extractHandoffFromSoap(
  input: ExtractHandoffInput
): Promise<ExtractHandoffResult> {
  const nextCheckItems: string[] = [];
  const ongoingMonitoring: string[] = [];
  let decisionRationale: string | null = null;

  // Extract from structured plan
  const plan = input.structuredPlan as Record<string, unknown> | null;
  if (plan && typeof plan === 'object') {
    if (Array.isArray(plan.followup_items)) {
      nextCheckItems.push(
        ...plan.followup_items.filter((i): i is string => typeof i === 'string').slice(0, 5)
      );
    }
    if (Array.isArray(plan.monitoring_items)) {
      ongoingMonitoring.push(
        ...plan.monitoring_items.filter((i): i is string => typeof i === 'string').slice(0, 5)
      );
    }
    if (typeof plan.rationale === 'string' && plan.rationale.trim()) {
      decisionRationale = plan.rationale.trim();
    }
  }

  // Extract from structured assessment
  const assessment = input.structuredAssessment as Record<string, unknown> | null;
  if (assessment && typeof assessment === 'object') {
    if (Array.isArray(assessment.issues) && nextCheckItems.length === 0) {
      nextCheckItems.push(
        ...assessment.issues
          .filter((i): i is string => typeof i === 'string')
          .slice(0, 3)
      );
    }
  }

  // Carry over previous handoff items if no new ones found
  const prev = input.previousHandoff as Record<string, unknown> | null;
  if (prev && typeof prev === 'object') {
    if (ongoingMonitoring.length === 0 && Array.isArray(prev.ongoing_monitoring)) {
      ongoingMonitoring.push(
        ...prev.ongoing_monitoring.filter((i): i is string => typeof i === 'string').slice(0, 5)
      );
    }
  }

  // Fallback from SOAP text
  if (nextCheckItems.length === 0 && input.soapPlan.trim()) {
    nextCheckItems.push(input.soapPlan.trim().slice(0, 200));
  }

  return {
    next_check_items: nextCheckItems,
    ongoing_monitoring: ongoingMonitoring,
    decision_rationale: decisionRationale,
    confidence: nextCheckItems.length > 0 ? 0.7 : 0.3,
    extracted_at: new Date().toISOString(),
  };
}
