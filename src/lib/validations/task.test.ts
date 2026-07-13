import { describe, expect, it } from 'vitest';
import { createTaskSchema, updateTaskSchema } from './task';

describe('task validation', () => {
  it.each([createTaskSchema, updateTaskSchema])(
    'rejects blank assignee IDs before route authorization checks',
    (schema) => {
      expect(schema.safeParse({ title: '依頼', assigned_to: '   ' }).success).toBe(false);
    },
  );

  it('normalizes a padded create assignee ID', () => {
    const parsed = createTaskSchema.parse({ title: '依頼', assigned_to: '  user_1  ' });
    expect(parsed.assigned_to).toBe('user_1');
  });

  it('normalizes a padded update assignee ID', () => {
    const parsed = updateTaskSchema.parse({ assigned_to: '  user_1  ' });
    expect(parsed.assigned_to).toBe('user_1');
  });

  it.each([createTaskSchema, updateTaskSchema])(
    'keeps null as an explicit unassignment',
    (schema) => {
      expect(schema.parse({ title: '依頼', assigned_to: null }).assigned_to).toBeNull();
    },
  );
});
