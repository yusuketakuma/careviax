import { describe, expect, it } from 'vitest';
import { buildAuditTaskHref } from './navigation';

describe('buildAuditTaskHref', () => {
  it('builds the audit page focused on a normal task id', () => {
    expect(buildAuditTaskHref('task_1')).toBe('/audit?taskId=task_1');
  });

  it('encodes task ids as query values without changing spaces to plus signs', () => {
    const taskId = '../task with space?x=1#frag';

    expect(buildAuditTaskHref(taskId)).toBe(`/audit?taskId=${encodeURIComponent(taskId)}`);
    expect(buildAuditTaskHref(taskId)).toContain('%20');
    expect(buildAuditTaskHref(taskId)).not.toContain('+');
  });
});
