import { describe, expect, it } from 'vitest';
import { communityFollowupsResponseSchema } from './community-followup-schema';

const ACTIVITY = {
  id: 'activity_1',
  title: '地域ケア会議',
  activity_type: 'conference',
  partner_name: '地域包括支援センター',
  follow_up_required: true,
  referrals_generated: 2,
  activity_date: '2026-07-12T01:00:00.000Z',
  org_id: 'provider-only',
  created_by: 'provider-only',
  description: 'provider-only free text',
};

function listMeta(
  overrides: Partial<{
    generated_at: string;
    limit: number;
    has_more: boolean;
    next_cursor: string | null;
  }> = {},
) {
  return {
    generated_at: '2026-07-16T00:00:00.000Z',
    limit: 8,
    has_more: false,
    next_cursor: null,
    ...overrides,
  };
}

describe('communityFollowupsResponseSchema', () => {
  it('projects only fields displayed by the external dashboard', () => {
    const parsed = communityFollowupsResponseSchema.parse({
      data: [ACTIVITY],
      meta: listMeta(),
    });

    expect(parsed.data[0]).not.toHaveProperty('org_id');
    expect(parsed.data[0]).not.toHaveProperty('created_by');
    expect(parsed.data[0]).not.toHaveProperty('description');
  });

  it.each([
    ['legacy root', [ACTIVITY]],
    [
      'non-follow-up row',
      {
        data: [{ ...ACTIVITY, follow_up_required: false }],
        meta: listMeta(),
      },
    ],
    [
      'negative referrals',
      {
        data: [{ ...ACTIVITY, referrals_generated: -1 }],
        meta: listMeta(),
      },
    ],
    [
      'invalid date',
      {
        data: [{ ...ACTIVITY, activity_date: '2026-07-12' }],
        meta: listMeta(),
      },
    ],
    [
      'duplicate identity',
      {
        data: [ACTIVITY, ACTIVITY],
        meta: listMeta(),
      },
    ],
    [
      'missing generated_at',
      { data: [ACTIVITY], meta: { limit: 8, has_more: false, next_cursor: null } },
    ],
    ['invalid generated_at', { data: [ACTIVITY], meta: listMeta({ generated_at: 'invalid' }) }],
    ['wrong limit', { data: [ACTIVITY], meta: listMeta({ limit: 50 }) }],
    ['cursor mismatch', { data: [ACTIVITY], meta: listMeta({ has_more: true }) }],
  ])('rejects %s', (_label, payload) => {
    expect(communityFollowupsResponseSchema.safeParse(payload).success).toBe(false);
  });
});
