// @vitest-environment jsdom

import { render, renderHook, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { MonthGrid, MonthGridNav, useMonthGrid } from './month-grid';

setupDomTestEnv();

describe('useMonthGrid', () => {
  it('builds leading null padding then 1..daysInMonth (Sunday start)', () => {
    // 2026-06 (month=5): 1日は月曜 → 先頭 null 1 個、30 日。
    const { result } = renderHook(() => useMonthGrid({ year: 2026, month: 5 }));
    expect(result.current.daysInMonth).toBe(30);
    expect(result.current.firstWeekday).toBe(1);
    expect(result.current.cells).toHaveLength(1 + 30);
    expect(result.current.cells[0]).toBeNull();
    expect(result.current.cells[1]).toEqual({ day: 1, dateKey: '2026-06-01' });
    expect(result.current.cells[30]).toEqual({ day: 30, dateKey: '2026-06-30' });
  });

  it('produces zero-padded local date keys', () => {
    // 2026-01 (month=0): 1日は木曜。
    const { result } = renderHook(() => useMonthGrid({ year: 2026, month: 0 }));
    expect(result.current.cells[result.current.firstWeekday]).toEqual({
      day: 1,
      dateKey: '2026-01-01',
    });
    expect(result.current.cells.at(-1)).toEqual({ day: 31, dateKey: '2026-01-31' });
  });

  it('handles a leap-year February (29 days)', () => {
    // 2028 is a leap year.
    const { result } = renderHook(() => useMonthGrid({ year: 2028, month: 1 }));
    expect(result.current.daysInMonth).toBe(29);
    expect(result.current.cells.at(-1)).toEqual({ day: 29, dateKey: '2028-02-29' });
  });

  it('handles a non-leap February (28 days)', () => {
    const { result } = renderHook(() => useMonthGrid({ year: 2026, month: 1 }));
    expect(result.current.daysInMonth).toBe(28);
    expect(result.current.cells.at(-1)).toEqual({ day: 28, dateKey: '2026-02-28' });
  });

  it('shifts the leading offset for weekStartsOn=1 (Monday start)', () => {
    // 2026-06-01 is Monday. Sunday-start → offset 1; Monday-start → offset 0.
    const sunday = renderHook(() => useMonthGrid({ year: 2026, month: 5, weekStartsOn: 0 }));
    const monday = renderHook(() => useMonthGrid({ year: 2026, month: 5, weekStartsOn: 1 }));
    expect(sunday.result.current.firstWeekday).toBe(1);
    expect(monday.result.current.firstWeekday).toBe(0);
    expect(monday.result.current.cells[0]).toEqual({ day: 1, dateKey: '2026-06-01' });
  });
});

describe('MonthGridNav', () => {
  it('renders the year/month label and default 前月/翌月 aria-labels', () => {
    const onPrev = vi.fn();
    const onNext = vi.fn();
    render(<MonthGridNav year={2026} month={5} onPrev={onPrev} onNext={onNext} />);
    expect(screen.getByText('2026年6月')).toBeTruthy();
    screen.getByRole('button', { name: '前月' }).click();
    screen.getByRole('button', { name: '翌月' }).click();
    expect(onPrev).toHaveBeenCalledTimes(1);
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it('allows overriding the nav aria labels per consumer', () => {
    render(
      <MonthGridNav
        year={2026}
        month={5}
        onPrev={vi.fn()}
        onNext={vi.fn()}
        prevLabel="前月を表示"
        nextLabel="翌月を表示"
      />,
    );
    expect(screen.getByRole('button', { name: '前月を表示' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '翌月を表示' })).toBeTruthy();
  });
});

describe('MonthGrid', () => {
  it('renders 7 weekday headers and one cell per day', () => {
    render(<MonthGrid year={2026} month={5} renderDay={(cell) => <span>{cell.day}</span>} />);
    for (const label of ['日', '月', '火', '水', '木', '金', '土']) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
    // 30 day cells in 2026-06.
    expect(screen.getByText('30')).toBeTruthy();
  });

  it('passes through day cell props (className + arbitrary attributes)', () => {
    const onClick = vi.fn();
    render(
      <MonthGrid
        year={2026}
        month={5}
        getDayCellProps={(cell) =>
          cell.day === 1
            ? {
                className: 'border-l-4 border-l-state-blocked',
                'aria-pressed': true,
                'data-date': cell.dateKey,
                onClick,
              }
            : {}
        }
        renderDay={(cell) => <span data-testid={`day-${cell.day}`}>{cell.day}</span>}
      />,
    );
    const dayOne = screen.getByTestId('day-1').parentElement as HTMLElement;
    expect(dayOne.className).toContain('border-l-state-blocked');
    expect(dayOne.getAttribute('aria-pressed')).toBe('true');
    expect(dayOne.getAttribute('data-date')).toBe('2026-06-01');
    dayOne.click();
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('rotates default weekday headers and aligns cells for weekStartsOn=1', () => {
    // 2026-06-01 is Monday → with Monday start the 1st sits in the first column (no leading null).
    const { container } = render(
      <MonthGrid
        year={2026}
        month={5}
        weekStartsOn={1}
        renderDay={(cell) => <span>{cell.day}</span>}
      />,
    );
    const headerCells = Array.from(container.firstElementChild!.children).slice(0, 7);
    expect(headerCells.map((el) => el.textContent)).toEqual([
      '月',
      '火',
      '水',
      '木',
      '金',
      '土',
      '日',
    ]);
    // 8th child (index 7) is the first body cell; for a Monday-start month starting Monday it is day 1.
    const firstBodyCell = container.firstElementChild!.children[7];
    expect(firstBodyCell.textContent).toBe('1');
  });

  it('renders custom weekday headers via renderWeekdayHeader', () => {
    render(
      <MonthGrid
        year={2026}
        month={5}
        renderWeekdayHeader={({ label, weekday }) => (
          <div data-testid={`wh-${weekday}`}>{label}!</div>
        )}
        renderDay={(cell) => <span>{cell.day}</span>}
      />,
    );
    expect(screen.getByTestId('wh-0').textContent).toBe('日!');
    expect(screen.getByTestId('wh-6').textContent).toBe('土!');
  });

  it('applies the container aria-label', () => {
    const { container } = render(
      <MonthGrid
        year={2026}
        month={5}
        ariaLabel="稼働日カレンダー"
        renderDay={(cell) => <span>{cell.day}</span>}
      />,
    );
    expect(container.querySelector('[aria-label="稼働日カレンダー"]')).toBeTruthy();
  });
});
