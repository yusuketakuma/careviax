import { describe, expect, it } from 'vitest';
import { TASKS_API_PATH, buildTaskApiPath, buildTasksApiPath } from './api-paths';

describe('task API path helpers', () => {
  it('builds task collection paths', () => {
    expect(TASKS_API_PATH).toBe('/api/tasks');
    expect(buildTasksApiPath()).toBe('/api/tasks');
  });

  it('builds task detail paths for normal ids', () => {
    expect(buildTaskApiPath('task_1')).toBe('/api/tasks/task_1');
  });

  it('encodes only the task id path segment', () => {
    const taskId = 'task/1?x=y#frag';

    expect(buildTaskApiPath(taskId)).toBe(`/api/tasks/${encodeURIComponent(taskId)}`);
  });

  it.each(['.', '..'])('rejects exact dot-segment task id %s', (taskId) => {
    expect(() => buildTaskApiPath(taskId)).toThrow(RangeError);
  });
});
