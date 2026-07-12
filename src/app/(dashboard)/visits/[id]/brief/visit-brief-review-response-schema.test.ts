import { describe, expect, it } from 'vitest';
import { visitBriefReviewResponseSchema } from './visit-brief-review-response-schema';

function buildPayload() {
  return {
    data: {
      patient: { id: 'patient_1', name: '患者A', archive: { status: 'active' } },
      context: 'patient',
      generated_at: '2026-07-13T00:00:00.000Z',
      medications: [{ drug_name: 'provider-only-drug' }],
      latest_labs: [{ analyte_label: 'provider-only-lab' }],
      rule_summary: {
        generation_id: 'rule_1',
        headline: 'ルール要約',
        bullets: [],
        source_refs: ['provider-only-ref'],
        generated_at: '2026-07-13T00:00:00.000Z',
      },
      ai_summary: {
        generation_id: 'ai_1',
        provider: 'openai',
        requested_provider: 'openai',
        is_fallback: false,
        model: 'gpt-test',
        headline: 'AI要約',
        bullets: [],
        source_refs: ['provider-only-ref'],
      },
    },
  };
}

describe('visitBriefReviewResponseSchema', () => {
  it('projects only the summary fields consumed by review and feedback', () => {
    const parsed = visitBriefReviewResponseSchema.parse(buildPayload());
    expect(parsed.data).not.toHaveProperty('medications');
    expect(parsed.data).not.toHaveProperty('latest_labs');
    expect(parsed.data.patient).not.toHaveProperty('archive');
    expect(parsed.data.ai_summary).not.toHaveProperty('source_refs');
  });

  it.each([
    { brief: buildPayload().data },
    { ...buildPayload(), debug: true },
    { data: { ...buildPayload().data, context: 'legacy' } },
    { data: { ...buildPayload().data, generated_at: 'not-a-date' } },
    {
      data: {
        ...buildPayload().data,
        ai_summary: { ...buildPayload().data.ai_summary, model: null },
      },
    },
  ])('rejects malformed visit-brief review payload %#', (payload) => {
    expect(visitBriefReviewResponseSchema.safeParse(payload).success).toBe(false);
  });
});
