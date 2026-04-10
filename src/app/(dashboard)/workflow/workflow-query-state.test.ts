import { describe, expect, it } from 'vitest';
import { readWorkflowState } from './workflow-query-state';

describe('workflow-query-state', () => {
  it('reads supported workflow focus params', () => {
    expect(
      readWorkflowState({
        focus: 'communication',
        context: 'dashboard_home',
      }),
    ).toEqual({
      initialFocus: 'communication',
      initialContext: 'dashboard_home',
    });
  });

  it('ignores unsupported workflow params', () => {
    expect(
      readWorkflowState({
        focus: 'later',
        context: 'other',
      }),
    ).toEqual({
      initialFocus: undefined,
      initialContext: null,
    });
  });
});
