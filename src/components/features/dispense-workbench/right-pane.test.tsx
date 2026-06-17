// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

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

const handlers = {
  onAuditOk: vi.fn(),
  onAuditNg: vi.fn(),
  onOpenHold: vi.fn(),
  onToggleCheck: vi.fn(),
  onSetNg: vi.fn(),
  onReturnToSet: vi.fn(),
} as unknown as WorkbenchWriteHandlers;

describe('RightPane set audit NG controls', () => {
  it('requires an NG classification before enabling rejected audit submission', () => {
    render(<RightPane view={setAuditView('')} phase="seta" handlers={handlers} />);

    expect((screen.getByRole('button', { name: 'NG・差戻し' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('enables rejected audit submission after an NG classification is selected', () => {
    render(<RightPane view={setAuditView('数量不足')} phase="seta" handlers={handlers} />);

    expect((screen.getByRole('button', { name: 'NG・差戻し' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });
});
