import { describe, expect, it } from 'vitest';
import { bulkCompleteTasksResponseSchema } from './bulk-completion-contract';

describe('bulk task completion contract', () => {
  it('accepts valid bulk completion response envelopes', () => {
    expect(
      bulkCompleteTasksResponseSchema.safeParse({
        data: {
          total: 2,
          completed: 1,
          failed: 1,
          failures: [
            {
              id: 'task_2',
              code: 'dedicated_completion_required',
              message: 'このタスクは専用画面で完了してください',
            },
          ],
        },
      }).success,
    ).toBe(true);
  });

  it('rejects malformed successful response envelopes', () => {
    for (const payload of [
      { data: 'bad-shape' },
      { data: { total: 2, completed: '1', failed: 1, failures: [] } },
      { data: { total: -1, completed: 0, failed: 0, failures: [] } },
      { data: { total: 2, completed: 2, failed: 1, failures: [] } },
      { data: { total: 2, completed: 1, failed: 1, failures: 'bad-shape' } },
      {
        data: {
          total: 2,
          completed: 1,
          failed: 1,
          failures: [{ id: 'task_2', code: 'unknown', message: '失敗しました' }],
        },
      },
    ]) {
      expect(bulkCompleteTasksResponseSchema.safeParse(payload).success).toBe(false);
    }
  });
});
