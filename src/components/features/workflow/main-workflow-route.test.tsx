// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { MAIN_WORKFLOW_STEPS, MainWorkflowCompactNav } from './main-workflow-route';

setupDomTestEnv();

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

describe('MainWorkflowCompactNav', () => {
  it('keeps the canonical business route order stable', () => {
    expect(MAIN_WORKFLOW_STEPS.map((step) => step.title)).toEqual([
      '処方登録',
      '調剤',
      '調剤監査',
      'セット',
      'セット監査',
      'スケジュール登録',
      '訪問時',
      '報告書',
    ]);
    expect(MAIN_WORKFLOW_STEPS.map((step) => step.key)).toEqual([
      'prescriptions',
      'dispensing',
      'auditing',
      'medication_sets',
      'set_audit',
      'schedules',
      'visits',
      'reports',
    ]);
  });

  it('renders all 8 steps and highlights the current stage', () => {
    render(<MainWorkflowCompactNav currentSteps={['schedules']} />);

    const nav = screen.getByTestId('main-workflow-compact-nav');
    const links = nav.querySelectorAll('ol a');
    expect(links).toHaveLength(8);
    expect(links[0]?.getAttribute('href')).toBe('/prescriptions');
    expect(links[5]?.getAttribute('href')).toBe('/schedules');
    expect(links[7]?.getAttribute('href')).toBe('/reports');

    expect(
      Array.from(nav.querySelectorAll('ol span')).filter((el) => el.textContent === '現在地'),
    ).toHaveLength(1);
    expect(screen.getByRole('link', { name: /スケジュール登録/ })).toBeTruthy();
  });

  it('opens a step description from the ? help affordance', () => {
    render(<MainWorkflowCompactNav currentSteps={['schedules']} />);

    const description = '訪問予定を登録し、日次運用へ乗る順番まで整えます。';
    expect(screen.queryByText(description)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'スケジュール登録の説明' }));

    expect(screen.getByRole('tooltip')).toBeTruthy();
    expect(screen.getByText(description)).toBeTruthy();
  });

  it('can highlight multiple stages for combined screens', () => {
    render(<MainWorkflowCompactNav currentSteps={['medication_sets', 'set_audit']} />);

    const nav = screen.getByTestId('main-workflow-compact-nav');
    expect(
      Array.from(nav.querySelectorAll('ol span')).filter((el) => el.textContent === '現在地'),
    ).toHaveLength(2);
    expect(screen.getAllByRole('link', { name: /セット監査/ }).length).toBeGreaterThan(0);
  });

  it('summarizes the current mobile stage with adjacent route links', () => {
    render(<MainWorkflowCompactNav currentSteps={['reports']} />);

    expect(screen.getByText('08/08')).toBeTruthy();
    expect(screen.getByRole('link', { name: '前: 訪問時' }).getAttribute('href')).toBe('/visits');
    expect(screen.queryByRole('link', { name: /^次:/ })).toBeNull();
  });
});
