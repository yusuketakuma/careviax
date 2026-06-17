// @vitest-environment jsdom

import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useWorkbenchStore } from './dispensing-workbench.store';
import { RightPane } from './right-pane';
import type { WorkbenchView } from './dispensing-workbench.types';
import type { WorkbenchWriteHandlers } from './use-workbench-write-handlers';

function setAuditView(ngValue: string): WorkbenchView {
  return {
    rightTitle: 'セット監査',
    isGrid: false,
    isSet: false,
    isSeta: true,
    target: {
      date: '2026/4/1（水）',
      timing: '朝食後',
      packetText: '1包',
      ptpText: '',
      hasPtp: false,
      drugs: ['アムロジピン錠5mg'],
      note: '',
      hasNote: false,
    },
    checkItems: [],
    ngValue,
    ngOptions: ['数量不足'],
    rejectList: [],
    rejectEmpty: true,
    riskList: [],
  } as unknown as WorkbenchView;
}

function setWorkView(): WorkbenchView {
  return {
    rightTitle: 'セット作業',
    isGrid: false,
    isSet: true,
    isSeta: false,
    target: {
      date: '2026/4/1（水）',
      timing: '朝食後',
      packetText: '1包',
      ptpText: '',
      hasPtp: false,
      drugs: ['アムロジピン錠5mg'],
      note: '',
      hasNote: false,
    },
    setMethod: 'お薬カレンダーの該当ポケットへ投入',
    setSteps: [],
    outsideMeds: [],
    outsideEmpty: true,
    packetItems: [],
  } as unknown as WorkbenchView;
}

const handlers = {
  onSetCell: vi.fn(),
  onAuditOk: vi.fn(),
  onAuditNg: vi.fn(),
  onOpenHold: vi.fn(),
  onToggleCheck: vi.fn(),
  onSetNg: vi.fn(),
  onReturnToSet: vi.fn(),
} as unknown as WorkbenchWriteHandlers;

describe('RightPane set work cell controls', () => {
  afterEach(() => {
    act(() => {
      useWorkbenchStore.setState({ target: null });
    });
  });

  it('requires a selected calendar cell before enabling set and hold actions', () => {
    render(<RightPane view={setWorkView()} phase="setp" handlers={handlers} />);

    expect(
      (screen.getByRole('button', { name: 'このセルへセット' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect((screen.getByRole('button', { name: '保留…' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('enables set and hold actions after a calendar cell is selected', () => {
    act(() => {
      useWorkbenchStore.setState({ target: { di: 0, tk: '朝' } });
    });

    render(<RightPane view={setWorkView()} phase="setp" handlers={handlers} />);

    expect(
      (screen.getByRole('button', { name: 'このセルへセット' }) as HTMLButtonElement).disabled,
    ).toBe(false);
    expect((screen.getByRole('button', { name: '保留…' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });
});

describe('RightPane set audit NG controls', () => {
  afterEach(() => {
    act(() => {
      useWorkbenchStore.setState({ target: null });
    });
  });

  it('requires an NG classification before enabling rejected audit submission', () => {
    act(() => {
      useWorkbenchStore.setState({ target: { di: 0, tk: '朝' } });
    });
    render(<RightPane view={setAuditView('')} phase="seta" handlers={handlers} />);

    expect((screen.getByRole('button', { name: 'NG・差戻し' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('requires a selected calendar cell before allowing NG classification', () => {
    render(<RightPane view={setAuditView('数量不足')} phase="seta" handlers={handlers} />);

    expect((screen.getByLabelText('NG分類') as HTMLSelectElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'NG・差戻し' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('enables rejected audit submission after an NG classification is selected', () => {
    act(() => {
      useWorkbenchStore.setState({ target: { di: 0, tk: '朝' } });
    });
    render(<RightPane view={setAuditView('数量不足')} phase="seta" handlers={handlers} />);

    expect((screen.getByRole('button', { name: 'NG・差戻し' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });
});
