import { describe, expect, it } from 'vitest';
import { buildDispenseTaskHref } from './navigation';

describe('buildDispenseTaskHref', () => {
  it('builds the dispense route focused on a normal task id', () => {
    expect(buildDispenseTaskHref('task_1')).toBe('/dispense?taskId=task_1');
  });

  it('encodes task ids as a query value without changing spaces to plus signs', () => {
    const taskId = '../task with space?x=1#frag';

    expect(buildDispenseTaskHref(taskId)).toBe(`/dispense?taskId=${encodeURIComponent(taskId)}`);
    expect(buildDispenseTaskHref(taskId)).toContain('%20');
    expect(buildDispenseTaskHref(taskId)).not.toContain('+');
  });
});
