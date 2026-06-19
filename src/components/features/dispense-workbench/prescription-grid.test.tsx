// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { PrescriptionGrid } from './prescription-grid';
import type { WorkbenchView } from './dispensing-workbench.types';
import type { WorkbenchWriteHandlers } from './use-workbench-write-handlers';

function gridView(): WorkbenchView {
  return {
    cur: {
      chips: [],
      rule: '',
    },
    rows: [
      {
        kind: 'sec',
        gid: 'group_1',
        secLabel: '朝食後',
        method: '一包化',
        start: '2026-06-20',
        days: 14,
        endDate: '2026-07-03',
      },
    ],
    methodOptions: ['一包化'],
    totals: {
      asa: '',
      hiru: '',
      yu: '',
      nemae: '',
      summary: '',
    },
    checkHead: '',
    progress: { label: '進捗', pct: '0%', color: '#2f6fd6', fraction: '0 / 1' },
    primary: {
      label: '保存',
      bg: '#2f6fd6',
      border: '#1f5ab8',
      cursor: 'pointer',
      opacity: '1',
    },
    bulkLabel: '一括',
  } as unknown as WorkbenchView;
}

describe('PrescriptionGrid', () => {
  it('describes group period inputs and constrains prescription days to positive integers', () => {
    const handlers = {
      onGroupMethod: vi.fn(),
      onGroupStart: vi.fn(),
      onGroupDays: vi.fn(),
      onDropTo: vi.fn(),
    } as unknown as WorkbenchWriteHandlers;

    render(<PrescriptionGrid view={gridView()} phase="dispense" handlers={handlers} />);

    const startInput = screen.getByLabelText('朝食後 服用開始日');
    const daysInput = screen.getByLabelText('朝食後 処方日数');

    expect(startInput.getAttribute('aria-describedby')).toBe('dispense-group-group_1-start-help');
    expect(daysInput.getAttribute('aria-describedby')).toBe('dispense-group-group_1-days-help');
    expect(daysInput.getAttribute('min')).toBe('1');
    expect(daysInput.getAttribute('step')).toBe('1');
    expect(screen.getByText('YYYY-MM-DD形式で入力してください。')).toBeTruthy();
    expect(screen.getByText('1以上の整数で入力してください。')).toBeTruthy();
  });
});
