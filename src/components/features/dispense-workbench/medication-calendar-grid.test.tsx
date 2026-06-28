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

function calendarViewWithGeneration(overrides: Partial<WorkbenchView>): WorkbenchView {
  return {
    ...calendarView(),
    batchGenerationVisible: true,
    batchGenerationLabel: 'セットバッチを生成',
    canGenerateBatches: false,
    canForceRegenerate: false,
    batchGenerationBlockedReason: '',
    ...overrides,
  } as WorkbenchView;
}

function gridHandlers(overrides: Partial<WorkbenchWriteHandlers> = {}): WorkbenchWriteHandlers {
  return {
    onSelectCell: vi.fn(),
    onBulk: vi.fn(),
    onPrimary: vi.fn(() => null),
    onGenerateBatches: vi.fn(),
    ...overrides,
  } as unknown as WorkbenchWriteHandlers;
}

describe('MedicationCalendarGrid set batch generation CTA', () => {
  it('does not render the generation CTA when generation metadata is absent', () => {
    render(<MedicationCalendarGrid view={calendarView()} phase="setp" handlers={gridHandlers()} />);

    expect(screen.queryByRole('button', { name: 'セットバッチを生成' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'セットバッチ再生成' })).toBeNull();
  });

  it('runs an initial generation on click when generation is permitted', () => {
    const onGenerateBatches = vi.fn();
    const onRequestRegenerate = vi.fn();
    render(
      <MedicationCalendarGrid
        view={calendarViewWithGeneration({ canGenerateBatches: true })}
        phase="setp"
        handlers={gridHandlers({ onGenerateBatches })}
        onRequestRegenerate={onRequestRegenerate}
      />,
    );

    const cta = screen.getByRole('button', { name: 'セットバッチを生成' });
    expect((cta as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(cta);

    expect(onGenerateBatches).toHaveBeenCalledTimes(1);
    expect(onGenerateBatches).toHaveBeenCalledWith();
    expect(onRequestRegenerate).not.toHaveBeenCalled();
  });

  it('opens the confirm dialog instead of generating directly on a force regenerate click', () => {
    const onGenerateBatches = vi.fn();
    const onRequestRegenerate = vi.fn();
    render(
      <MedicationCalendarGrid
        view={calendarViewWithGeneration({
          canForceRegenerate: true,
          batchGenerationLabel: 'セットバッチ再生成',
        })}
        phase="setp"
        handlers={gridHandlers({ onGenerateBatches })}
        onRequestRegenerate={onRequestRegenerate}
      />,
    );

    const cta = screen.getByRole('button', { name: 'セットバッチ再生成' });
    fireEvent.click(cta);

    expect(onRequestRegenerate).toHaveBeenCalledTimes(1);
    expect(onGenerateBatches).not.toHaveBeenCalled();
  });

  it('disables the CTA and surfaces the blocked reason as a tooltip when neither action is allowed', () => {
    const onGenerateBatches = vi.fn();
    render(
      <MedicationCalendarGrid
        view={calendarViewWithGeneration({
          batchGenerationLabel: 'セットバッチ再生成',
          batchGenerationBlockedReason:
            'セット監査後は再生成できません（差戻し後に実行してください）',
        })}
        phase="setp"
        handlers={gridHandlers({ onGenerateBatches })}
      />,
    );

    const cta = screen.getByRole('button', { name: 'セットバッチ再生成' });
    expect((cta as HTMLButtonElement).disabled).toBe(true);
    expect(cta.getAttribute('title')).toBe(
      'セット監査後は再生成できません（差戻し後に実行してください）',
    );

    fireEvent.click(cta);
    expect(onGenerateBatches).not.toHaveBeenCalled();
  });
});

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
