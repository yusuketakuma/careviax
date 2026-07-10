// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { PrescriptionGrid } from './prescription-grid';
import type { WorkbenchView } from './dispensing-workbench.types';
import type { WorkbenchWriteHandlers } from './use-workbench-write-handlers';

function gridView(): WorkbenchView {
  return {
    cur: {
      chips: [{ label: '冷所', color: '#155eef', bg: '#eff8ff', border: '#b2ddff' }],
      rule: '冷所品は別容器で確認',
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
        periodWarning: { label: '期間確認', detail: '処方期間を確認してください' },
      },
      {
        kind: 'drug',
        did: 'drug_1',
        gid: 'group_1',
        no: 1,
        name: 'アムロジピン錠5mg',
        yoho: '朝食後',
        formL: '錠',
        formBg: '#155eef',
        other: '頓服',
        hasChg: true,
        chgText: '変更',
        chgColor: '#b42318',
        asa: '1',
        hiru: '0',
        yu: '0',
        nemae: '0',
        daily: '1錠',
        daysLabel: '14日',
        funsai: true,
        hasTag: true,
        tag: '冷所',
        tagColor: '#155eef',
        note: '数量を照合してください',
        noteColor: '#b42318',
        bg: '#ffffff',
        checkBg: '#ffffff',
        checkBorder: '#98a2b3',
        checkMark: '',
        showQuantityConfirm: true,
        quantityConfirmed: false,
        quantityConfirmLocked: false,
        quantityConfirmLabel: '実数量を確認',
        quantityLabel: '処方数量 14錠',
        actualQuantityInput: '14',
        actualQuantityStep: '1',
        actualQuantityInputMode: 'numeric',
        actualQuantityDisabled: false,
        discrepancyReasonValue: '数量差異なし',
        requiresDiscrepancyReason: true,
        showAuditDoubleCount: true,
        auditFirstCountInput: '14',
        auditSecondCountInput: '14',
        auditCountExpectedLabel: '14錠',
        auditCountExpectedQuantity: 14,
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

function expectInlineFontSizesAtLeast12(container: HTMLElement) {
  const fontSizedElements = [...container.querySelectorAll<HTMLElement>('[style]')].filter(
    (element) => element.style.fontSize.endsWith('px'),
  );

  expect(fontSizedElements).not.toHaveLength(0);
  for (const element of fontSizedElements) {
    expect(Number.parseFloat(element.style.fontSize)).toBeGreaterThanOrEqual(12);
  }
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

  it('keeps the populated prescription and audit evidence at the 12px minimum', () => {
    const { container } = render(<PrescriptionGrid view={gridView()} phase="dispense" />);

    expectInlineFontSizesAtLeast12(container);
    expect(screen.getByText('変更').style.fontSize).toBe('12px');
    for (const coldStorageTag of screen.getAllByText('冷所')) {
      expect(coldStorageTag.style.fontSize).toBe('12px');
    }
    expect(screen.getAllByText('粉砕').at(-1)?.style.fontSize).toBe('12px');
    expect(screen.getByText('麻薬計数').style.fontSize).toBe('12px');
    expect(screen.getByLabelText('アムロジピン錠5mg 実数量')).toBeTruthy();
    expect(screen.getByLabelText('アムロジピン錠5mg ダブルカウント1回目')).toBeTruthy();
    expect(screen.getByLabelText('アムロジピン錠5mg ダブルカウント2回目')).toBeTruthy();
  });
});
