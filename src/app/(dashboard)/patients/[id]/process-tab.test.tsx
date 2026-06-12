// @vitest-environment jsdom

import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ProcessTab } from './process-tab';
import type { PatientWorkspace } from './patient-detail.types';

function buildWorkspace(overrides: Partial<PatientWorkspace> = {}): PatientWorkspace {
  return {
    cycle_id: 'cycle_1',
    overall_status: 'audit_pending',
    exception_status: null,
    current_intake: null,
    safety: {
      renal: null,
      allergy: null,
      handling_tags: [],
      swallowing: null,
      cautions: [],
    },
    prescription_lines: [],
    recent_activities: [],
    today_tasks: [],
    open_exceptions: [],
    medication_changes: [],
    previous_medication: null,
    current_medication: null,
    set_plan: null,
    prescription_document_url: null,
    ...overrides,
  };
}

describe('ProcessTab', () => {
  it('renders the shared 9-step process chips for profile view', () => {
    render(<ProcessTab workspace={buildWorkspace()} />);

    const chips = screen.getByTestId('process-chips');
    for (const label of [
      '取込',
      '入力',
      '判断',
      '調剤',
      '監査',
      'セット',
      '訪問',
      '報告',
      '算定',
    ]) {
      expect(within(chips).getByText(label)).toBeTruthy();
    }
    expect(within(chips).queryByText('調剤鑑査')).toBeNull();
    expect(within(chips).getByText('監査').getAttribute('data-state')).toBe('current');
  });

  it('keeps out-of-flow statuses out of the linear chips', () => {
    render(<ProcessTab workspace={buildWorkspace({ overall_status: 'on_hold' })} />);

    expect(screen.queryByTestId('process-chips')).toBeNull();
    expect(screen.getByText('保留中')).toBeTruthy();
    expect(screen.getByText(/線形工程の外/)).toBeTruthy();
  });
});
