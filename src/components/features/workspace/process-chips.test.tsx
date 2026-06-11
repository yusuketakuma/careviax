// @vitest-environment jsdom

import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { ProcessChips, ProcessProgressDots } from './process-chips';

setupDomTestEnv();

describe('ProcessChips', () => {
  it('renders the 9 steps in the new design order', () => {
    render(<ProcessChips currentStep="audit" />);

    const list = screen.getByTestId('process-chips');
    const items = within(list).getAllByRole('listitem');
    expect(items.map((item) => item.textContent)).toEqual([
      '取込',
      '入力',
      '判断',
      '調剤',
      '監査',
      'セット',
      '訪問',
      '報告',
      '算定',
    ]);
  });

  it('marks done steps green with a check, the current step as blue filled, future steps as muted', () => {
    render(<ProcessChips currentStep="audit" />);

    const list = screen.getByTestId('process-chips');
    const chipStates = Array.from(list.querySelectorAll('[data-state]')).map((chip) =>
      chip.getAttribute('data-state'),
    );
    expect(chipStates).toEqual([
      'done',
      'done',
      'done',
      'done',
      'current',
      'upcoming',
      'upcoming',
      'upcoming',
      'upcoming',
    ]);

    const doneChip = within(list).getByText('調剤');
    expect(doneChip.className).toContain('border-emerald-300');
    expect(doneChip.querySelector('svg')).toBeTruthy();

    const currentChip = within(list).getByText('監査');
    expect(currentChip.getAttribute('aria-current')).toBe('step');
    expect(currentChip.className).toContain('bg-primary');
    expect(currentChip.querySelector('svg')).toBeNull();

    const upcomingChip = within(list).getByText('セット');
    expect(upcomingChip.getAttribute('aria-current')).toBeNull();
    expect(upcomingChip.className).toContain('text-muted-foreground');
    expect(upcomingChip.querySelector('svg')).toBeNull();
  });

  it('treats the first step as current for intake (no done steps)', () => {
    render(<ProcessChips currentStep="intake" />);

    const list = screen.getByTestId('process-chips');
    expect(list.querySelector('[data-state="done"]')).toBeNull();
    expect(within(list).getByText('取込').getAttribute('aria-current')).toBe('step');
  });

  it('marks every previous step done when the last step (算定) is current', () => {
    render(<ProcessChips currentStep="billing" />);

    const list = screen.getByTestId('process-chips');
    expect(list.querySelectorAll('[data-state="done"]')).toHaveLength(8);
    expect(within(list).getByText('算定').getAttribute('aria-current')).toBe('step');
  });
});

describe('ProcessProgressDots', () => {
  it('renders 9 dots with done/current/upcoming states and the current step label', () => {
    render(<ProcessProgressDots currentStep="audit" />);

    const dots = screen.getByTestId('process-progress-dots');
    const states = Array.from(dots.querySelectorAll('[data-state]')).map((dot) =>
      dot.getAttribute('data-state'),
    );
    expect(states).toEqual([
      'done',
      'done',
      'done',
      'done',
      'current',
      'upcoming',
      'upcoming',
      'upcoming',
      'upcoming',
    ]);
    expect(within(dots).getByText('監査')).toBeTruthy();
    expect(dots.getAttribute('aria-label')).toBe('工程: 監査(5/9)');
  });

  it('shows no done dots and the 取込 label for the first step', () => {
    render(<ProcessProgressDots currentStep="intake" />);

    const dots = screen.getByTestId('process-progress-dots');
    expect(dots.querySelector('[data-state="done"]')).toBeNull();
    expect(within(dots).getByText('取込')).toBeTruthy();
  });
});
