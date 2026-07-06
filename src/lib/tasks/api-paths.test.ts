import { describe, expect, it } from 'vitest';
import {
  TASKS_API_PATH,
  TASKS_HEALTH_BOARD_API_PATH,
  buildTaskApiPath,
  buildTasksApiPath,
  buildTasksHealthBoardApiPath,
} from './api-paths';

describe('task API path helpers', () => {
  it('builds task collection paths', () => {
    expect(TASKS_API_PATH).toBe('/api/tasks');
    expect(buildTasksApiPath()).toBe('/api/tasks');
  });

  it('builds task detail paths for normal ids', () => {
    expect(buildTaskApiPath('task_1')).toBe('/api/tasks/task_1');
  });

  it('builds the task health board path without an empty query string', () => {
    expect(TASKS_HEALTH_BOARD_API_PATH).toBe('/api/tasks/health-board');
    expect(buildTasksHealthBoardApiPath()).toBe('/api/tasks/health-board');
  });

  it('builds encoded task health board query strings', () => {
    expect(
      buildTasksHealthBoardApiPath({
        scope: 'mine',
        limit: 500,
        task_type: 'conference/action item',
      }),
    ).toBe('/api/tasks/health-board?scope=mine&limit=500&task_type=conference%2Faction+item');
  });

  it('builds risk-domain task health board filters', () => {
    expect(buildTasksHealthBoardApiPath({ risk_domain: 'medication' })).toBe(
      '/api/tasks/health-board?risk_domain=medication',
    );
  });

  it('encodes only the task id path segment', () => {
    const taskId = 'task/1?x=y#frag';

    expect(buildTaskApiPath(taskId)).toBe(`/api/tasks/${encodeURIComponent(taskId)}`);
  });

  it.each(['.', '..'])('rejects exact dot-segment task id %s', (taskId) => {
    expect(() => buildTaskApiPath(taskId)).toThrow(RangeError);
  });
});
