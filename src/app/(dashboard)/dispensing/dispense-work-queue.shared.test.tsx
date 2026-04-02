// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import type { AnchorHTMLAttributes } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

import {
  clampSelectedRowIndex,
  QueueDueDate,
  QueuePatientLink,
  QueuePriorityBadge,
  useSelectableQueueState,
} from './dispense-work-queue.shared';

setupDomTestEnv();

describe('dispense-work-queue.shared', () => {
  it('renders patient links with kana when available', () => {
    render(
      <QueuePatientLink href="/dispensing/task_1" name="山田花子" nameKana="ヤマダハナコ" />
    );

    const link = screen.getByRole('link', { name: '山田花子(ヤマダハナコ)' });
    expect(link.getAttribute('href')).toBe('/dispensing/task_1');
  });

  it('renders overdue due dates in compact auditing mode', () => {
    render(
      <QueueDueDate
        dueDate="2026-04-02T09:30:00.000Z"
        isOverdue
        showIcon={false}
      />
    );

    expect(screen.getByText(/04\/02/)).toBeTruthy();
    expect(screen.getByText(/期限超過/)).toBeTruthy();
  });

  it('falls back to the normal priority badge for unknown priorities', () => {
    render(<QueuePriorityBadge priority="unknown" />);
    expect(screen.getByText('通常')).toBeTruthy();
  });

  it('clamps selected row indices into the visible range', () => {
    expect(clampSelectedRowIndex(-2, 5)).toBe(0);
    expect(clampSelectedRowIndex(9, 3)).toBe(2);
    expect(clampSelectedRowIndex(1, 0)).toBe(0);
  });

  it('keeps selected queue state within the visible range as rows change', () => {
    function Probe({ items }: { items: Array<{ id: string }> }) {
      const {
        selectedItem,
        selectedRowIndex,
        handleMoveDown,
        handleRowClick,
      } = useSelectableQueueState(items);

      return (
        <div>
          <button type="button" onClick={handleMoveDown}>
            down
          </button>
          <button type="button" onClick={() => handleRowClick(5)}>
            jump
          </button>
          <span data-testid="selected-index">{selectedRowIndex}</span>
          <span data-testid="selected-id">{selectedItem?.id ?? 'none'}</span>
        </div>
      );
    }

    const { rerender } = render(
      <Probe items={[{ id: 'task_1' }, { id: 'task_2' }, { id: 'task_3' }]} />
    );

    fireEvent.click(screen.getByRole('button', { name: 'jump' }));
    expect(screen.getByTestId('selected-index').textContent).toBe('2');
    expect(screen.getByTestId('selected-id').textContent).toBe('task_3');

    rerender(<Probe items={[{ id: 'task_1' }]} />);
    expect(screen.getByTestId('selected-index').textContent).toBe('0');
    expect(screen.getByTestId('selected-id').textContent).toBe('task_1');
  });
});
