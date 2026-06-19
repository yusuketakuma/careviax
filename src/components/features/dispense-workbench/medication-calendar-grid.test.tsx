// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { MedicationCalendarGrid } from './medication-calendar-grid';
import type { WorkbenchView } from './dispensing-workbench.types';
import type { WorkbenchWriteHandlers } from './use-workbench-write-handlers';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

function calendarView(): WorkbenchView {
  return {
    phase: 'setp',
    isGrid: false,
    isCal: true,
    isSet: true,
    isSeta: false,
    changes: [],
    changesEmpty: true,
    setChips: [],
    calBarTitle: 'セット注意',
    calBarBg: '#fff',
    calBarMeta: '1日分',
    calDays: [{ d: '6/1', w: '月', color: '#274268', bg: '#e7edf4' }],
    calRows: [
      {
        label: '朝食後',
        cells: [
          {
            packetText: '1包',
            packetColor: '#16345a',
            ptpText: '追加PTP 1錠',
            hasPtp: true,
            bg: '#fff6e6',
            border: '1px solid #e8c884',
            mark: '⏸',
            markColor: '#9a6a18',
            stateLabel: '保留：患者メモにある自由記述',
            stateColor: '#9a6a18',
            title: '保留理由：患者メモにある自由記述 / 担当 田中',
            di: 0,
            tk: '朝',
            selected: true,
          },
        ],
      },
    ],
    calLegend: [{ label: '保留', bg: '#fff6e6', bd: '#e8c884' }],
    photoTitle: '作業証跡',
    photos: [],
    progress: { label: '進捗', pct: '50%', color: '#2f6fd6', fraction: '1 / 2' },
    gate: { ok: true, text: '完了可能', color: '#1f9150', bg: '#eef8f0', border: '#9ed6ad' },
    primary: {
      label: '次工程へ',
      bg: '#2f6fd6',
      border: '#1f5ab8',
      cursor: 'pointer',
      opacity: '1',
    },
    bulkLabel: '一括セット',
  } as unknown as WorkbenchView;
}

describe('MedicationCalendarGrid', () => {
  it('renders calendar cells as native buttons with minimized accessible names', () => {
    const onSelectCell = vi.fn();
    const handlers = {
      onSelectCell,
      onBulk: vi.fn(),
      onPrimary: vi.fn(() => null),
    } as unknown as WorkbenchWriteHandlers;

    render(<MedicationCalendarGrid view={calendarView()} phase="setp" handlers={handlers} />);

    const cell = screen.getByRole('button', {
      name: '服薬カレンダーセル / 1日目 / 朝 / 1包 / 追加PTP 1錠 / 保留',
    });
    expect(cell.tagName).toBe('BUTTON');
    expect(cell.getAttribute('type')).toBe('button');
    expect(cell.getAttribute('aria-label')).not.toContain('患者メモ');
    expect(cell.getAttribute('aria-label')).not.toContain('田中');
    expect(cell.getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(cell);

    expect(onSelectCell).toHaveBeenCalledWith(0, '朝');
  });
});
