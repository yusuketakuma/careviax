import { describe, expect, it } from 'vitest';
import { performanceProposalsResponseSchema } from './performance-proposal-schema';

const PROPOSAL = {
  id: 'proposal_1',
  proposed_date: '2026-07-13T00:00:00.000Z',
  priority: 'emergency',
  proposal_status: 'proposed',
  patient_contact_status: 'pending',
  assignment_mode: 'fallback',
  route_distance_score: 12.5,
  proposal_reason: '訪問期限',
  visit_deadline_date: '2026-07-14T00:00:00.000Z',
  case_: { patient: { name: '患者A', residences: [{ address: 'provider-only' }] } },
  contact_logs: [{ note: 'provider-only' }],
};

describe('performanceProposalsResponseSchema', () => {
  it('projects only proposal fields used by performance metrics', () => {
    const parsed = performanceProposalsResponseSchema.parse({ data: [PROPOSAL] });

    expect(parsed.data[0]).not.toHaveProperty('contact_logs');
    expect(parsed.data[0].case_.patient).toEqual({ name: '患者A' });
  });

  it.each([
    ['legacy root', [PROPOSAL]],
    ['duplicate identity', { data: [PROPOSAL, PROPOSAL] }],
    ['invalid contact state', { data: [{ ...PROPOSAL, patient_contact_status: 'unknown' }] }],
    ['negative route score', { data: [{ ...PROPOSAL, route_distance_score: -1 }] }],
  ])('rejects %s', (_label, payload) => {
    expect(performanceProposalsResponseSchema.safeParse(payload).success).toBe(false);
  });
});
