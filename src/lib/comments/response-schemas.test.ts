import { describe, expect, it } from 'vitest';
import {
  buildCreateCommentResponseSchema,
  commentListResponseSchema,
  deleteCommentResponseSchema,
} from './response-schemas';

function comment(id: string, createdAt: string) {
  return {
    id,
    author_id: 'user_1',
    author_name: '田中',
    content: '確認お願いします',
    mentions: ['user_2'],
    created_at: createdAt,
  };
}

describe('comment response schemas', () => {
  it('accepts an oldest-first comment list', () => {
    expect(
      commentListResponseSchema.parse({
        data: [
          comment('comment_1', '2026-07-12T00:00:00.000Z'),
          comment('comment_2', '2026-07-13T00:00:00.000Z'),
        ],
      }).data,
    ).toHaveLength(2);
  });

  it.each([
    [
      'duplicate comment',
      [
        comment('comment_1', '2026-07-12T00:00:00.000Z'),
        comment('comment_1', '2026-07-13T00:00:00.000Z'),
      ],
    ],
    [
      'reverse order',
      [
        comment('comment_2', '2026-07-13T00:00:00.000Z'),
        comment('comment_1', '2026-07-12T00:00:00.000Z'),
      ],
    ],
    [
      'duplicate mention',
      [{ ...comment('comment_1', '2026-07-12T00:00:00.000Z'), mentions: ['user_2', 'user_2'] }],
    ],
  ])('rejects %s', (_label, data) => {
    expect(commentListResponseSchema.safeParse({ data }).success).toBe(false);
  });

  it('validates and minimizes a created comment', () => {
    const parsed = buildCreateCommentResponseSchema({
      entityType: 'patient',
      entityId: 'patient_1',
      content: '確認お願いします',
      mentions: ['user_2'],
    }).parse({
      data: {
        id: 'comment_1',
        org_id: 'org_1',
        entity_type: 'patient',
        entity_id: 'patient_1',
        author_id: 'user_1',
        content: '確認お願いします',
        mentions: ['user_2'],
        created_at: '2026-07-13T00:00:00.000Z',
        updated_at: '2026-07-13T00:00:00.000Z',
      },
    });
    expect(parsed.data).not.toHaveProperty('org_id');
    expect(parsed.data).not.toHaveProperty('author_id');
  });

  it('rejects a created comment for another entity', () => {
    expect(
      buildCreateCommentResponseSchema({
        entityType: 'patient',
        entityId: 'patient_1',
        content: '確認',
        mentions: [],
      }).safeParse({
        data: {
          id: 'comment_1',
          entity_type: 'patient',
          entity_id: 'patient_2',
          content: '確認',
          mentions: [],
          created_at: '2026-07-13T00:00:00.000Z',
        },
      }).success,
    ).toBe(false);
  });

  it('requires an exact delete acknowledgement', () => {
    expect(deleteCommentResponseSchema.safeParse({ data: { deleted: true } }).success).toBe(true);
    expect(deleteCommentResponseSchema.safeParse({ deleted: true }).success).toBe(false);
  });
});
