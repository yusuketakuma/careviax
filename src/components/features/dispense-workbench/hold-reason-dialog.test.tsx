// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { HoldReasonDialog } from './hold-reason-dialog';
import { useWorkbenchStore } from './dispensing-workbench.store';
import type { WorkbenchView } from './dispensing-workbench.types';

function holdView(): WorkbenchView {
  return {
    holdOpen: true,
    holdCellLabel: '2027年1月1日（金） 朝食後',
    holdReasons: [{ label: '在庫不足', selected: true }],
    holdReady: true,
    holdDue: '',
    holdOwner: '',
    holdMemo: '',
    holdSave: {
      cursor: 'pointer',
      bg: '#b54708',
      border: '#93370d',
      opacity: '1',
    },
  } as unknown as WorkbenchView;
}

function HoldDialogHarness() {
  const holdModal = useWorkbenchStore((state) => state.holdModal);
  const openHold = useWorkbenchStore((state) => state.openHold);
  return (
    <>
      <button type="button" onClick={() => openHold({ di: 0, tk: 'morning' })}>
        保留を開く
      </button>
      {holdModal && <HoldReasonDialog view={holdView()} phase="setp" />}
    </>
  );
}

afterEach(() => {
  act(() => {
    useWorkbenchStore.setState({ holdModal: null });
  });
  document.body.innerHTML = '';
});

describe('HoldReasonDialog typography floor', () => {
  it('keeps the held cell, required legend, and field labels at the 12px minimum', () => {
    render(<HoldReasonDialog view={holdView()} phase="setp" />);

    const heldCell = screen.getByText('2027年1月1日（金） 朝食後');
    expect(heldCell.style.fontSize).toBe('12px');
    expect(heldCell.style.overflowWrap).toBe('anywhere');
    expect(screen.getByText('保留理由（必須）').style.fontSize).toBe('12px');
    expect(screen.getByText('期限').style.fontSize).toBe('12px');
    expect(screen.getByText('担当').style.fontSize).toBe('12px');
    expect(screen.getByText('メモ').style.fontSize).toBe('12px');
  });

  it('returns focus to the hold trigger after Escape cancels the dialog', async () => {
    render(<HoldDialogHarness />);

    const trigger = screen.getByRole('button', { name: '保留を開く' });
    trigger.focus();
    fireEvent.click(trigger);

    const firstReason = await screen.findByRole('radio', { name: '在庫不足' });
    expect(document.activeElement).toBe(firstReason);

    fireEvent.keyDown(firstReason, { key: 'Escape' });

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: /保留理由の登録/ })).toBeNull();
    });
    expect(document.activeElement).toBe(trigger);
  });
});
