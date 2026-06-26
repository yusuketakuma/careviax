// @vitest-environment jsdom

import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { isSameDay, addDays } from 'date-fns';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { DayNavigator } from '@/components/ui/day-navigator';

setupDomTestEnv();

const TODAY = new Date('2026-06-26T09:00:00');

describe('DayNavigator', () => {
  it('renders the target date with weekday', () => {
    render(<DayNavigator value={TODAY} onChange={() => {}} now={TODAY} />);
    expect(screen.getByText(/6月26日/)).toBeTruthy();
  });

  it('moves to the previous and next day', () => {
    const onChange = vi.fn();
    render(<DayNavigator value={TODAY} onChange={onChange} now={TODAY} />);
    fireEvent.click(screen.getByRole('button', { name: '前日' }));
    expect(isSameDay(onChange.mock.calls[0][0], addDays(TODAY, -1))).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '翌日' }));
    expect(isSameDay(onChange.mock.calls[1][0], addDays(TODAY, 1))).toBe(true);
  });

  it('disables 今日 when already on today, enables it otherwise', () => {
    const { rerender } = render(<DayNavigator value={TODAY} onChange={() => {}} now={TODAY} />);
    expect((screen.getByRole('button', { name: '今日へ移動' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    rerender(<DayNavigator value={addDays(TODAY, 3)} onChange={() => {}} now={TODAY} />);
    expect((screen.getByRole('button', { name: '今日へ移動' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it('jumps back to today', () => {
    const onChange = vi.fn();
    render(<DayNavigator value={addDays(TODAY, 5)} onChange={onChange} now={TODAY} />);
    fireEvent.click(screen.getByRole('button', { name: '今日へ移動' }));
    expect(isSameDay(onChange.mock.calls[0][0], TODAY)).toBe(true);
  });

  it('handles an invalid date without crashing (disabled nav + 確認 label)', () => {
    render(<DayNavigator value="not-a-date" onChange={() => {}} now={TODAY} />);
    expect(screen.getByText('日付を確認')).toBeTruthy();
    expect((screen.getByRole('button', { name: '前日' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: '翌日' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
