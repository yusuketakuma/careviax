import { describe, expect, it } from 'vitest';
import {
  handoffConfirmationTasksResponseSchema,
  recentHandoffCommentsResponseSchema,
} from './workspace-response-schemas';

describe('handoff workspace response schemas', () => {
  it('accepts a complete bounded confirmation task page', () => {
    expect(
      handoffConfirmationTasksResponseSchema.safeParse({
        data: [
          {
            id: 'task_1',
            task_type: 'handoff_confirmation',
            title: '申し送り確認',
            priority: 'high',
            due_date: null,
            related_entity_id: 'visit_record_1',
            created_at: '2026-07-13T00:00:00.000Z',
          },
        ],
        meta: { has_more: false, next_cursor: null },
      }).success,
    ).toBe(true);
  });

  it('rejects an incomplete task page', () => {
    expect(
      handoffConfirmationTasksResponseSchema.safeParse({
        data: [],
        meta: { has_more: true, next_cursor: 'task_50' },
      }).success,
    ).toBe(false);
  });

  it('accepts newest-first comments involving the current user', () => {
    expect(
      recentHandoffCommentsResponseSchema.safeParse({
        data: [
          {
            id: 'comment_1',
            entity_type: 'patient',
            entity_id: 'patient_1',
            content: '確認',
            author_id: 'user_2',
            author_name: '田中',
            mentions_me: true,
            authored_by_me: false,
            created_at: '2026-07-13T00:00:00.000Z',
          },
        ],
      }).success,
    ).toBe(true);
  });

  it('rejects a comment unrelated to the current user', () => {
    expect(
      recentHandoffCommentsResponseSchema.safeParse({
        data: [
          {
            id: 'comment_1',
            entity_type: 'patient',
            entity_id: 'patient_1',
            content: '確認',
            author_id: 'user_2',
            author_name: '田中',
            mentions_me: false,
            authored_by_me: false,
            created_at: '2026-07-13T00:00:00.000Z',
          },
        ],
      }).success,
    ).toBe(false);
  });
});
