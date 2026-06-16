// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { WorkflowPhasePanel } from './workflow-phase-panel';

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

vi.mock('@/lib/hooks/use-workflow-phase-access', () => ({
  useWorkflowPhaseAccess: () => ({ phaseAccess: null }),
}));

describe('WorkflowPhasePanel', () => {
  it('shows phase summaries from the shared help popover', () => {
    render(
      <WorkflowPhasePanel
        currentPhase="dispensing"
        phaseKeys={['dispensing']}
        phaseAccess={
          {
            dispensing: {
              key: 'dispensing',
              label: '調剤',
              href: '/dispense',
              summary: '調剤待ちの処方を確認します。',
              pending_count: 2,
              tone: 'default',
              next_action: null,
            },
          } as never
        }
      />,
    );

    expect(screen.queryByText('調剤待ちの処方を確認します。')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '調剤の説明' }));

    expect(screen.getByText('調剤待ちの処方を確認します。')).toBeTruthy();
  });
});
