import { describe, expect, it } from 'vitest';
import {
  buildDispenseTaskApiPath,
  buildPrescriptionLineApiPath,
  buildSetPlanApiPath,
} from './api-paths';

describe('dispensing API path helpers', () => {
  it('builds dispense task paths with suffixes outside the encoded task id', () => {
    const taskId = 'task/1?mode=x#frag';

    expect(buildDispenseTaskApiPath(taskId, '/workbench')).toBe(
      `/api/dispense-tasks/${encodeURIComponent(taskId)}/workbench`,
    );
  });

  it('builds prescription line paths with the line id as one path segment', () => {
    const lineId = 'line/1?mode=x#frag';

    expect(buildPrescriptionLineApiPath(lineId)).toBe(
      `/api/prescription-lines/${encodeURIComponent(lineId)}`,
    );
  });

  it('builds set plan paths with suffixes outside the encoded plan id', () => {
    const planId = 'plan/1?mode=x#frag';

    expect(buildSetPlanApiPath(planId, '/batches/cell')).toBe(
      `/api/set-plans/${encodeURIComponent(planId)}/batches/cell`,
    );
  });

  it.each(['.', '..'])('rejects exact dot-segment id %s', (id) => {
    expect(() => buildDispenseTaskApiPath(id, '/workbench')).toThrow(RangeError);
    expect(() => buildPrescriptionLineApiPath(id)).toThrow(RangeError);
    expect(() => buildSetPlanApiPath(id, '/calendar')).toThrow(RangeError);
  });
});
