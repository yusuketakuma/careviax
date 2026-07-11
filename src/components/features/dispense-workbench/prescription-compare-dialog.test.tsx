// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { useWorkbenchStore } from './dispensing-workbench.store';
import type { WorkbenchView } from './dispensing-workbench.types';
import { PrescriptionCompareDialog } from './prescription-compare-dialog';

function compareView(compareOpen: boolean): WorkbenchView {
  return {
    compareOpen,
    cur: { name: '経路 花子' },
    cmpCount: { cont: 1, neu: 0, chg: 0, disc: 0 },
    compareSections: [
      {
        key: 'cont',
        title: '継続',
        color: '#2f7d32',
        items: [{ name: 'アムロジピン錠5mg', sub: '前回と同じ' }],
      },
    ],
  } as unknown as WorkbenchView;
}

function CompareDialogHarness() {
  const compareOpen = useWorkbenchStore((state) => state.compareOpen);
  const openCompare = useWorkbenchStore((state) => state.openCompare);
  return (
    <>
      <button type="button" onClick={openCompare}>
        比較を開く
      </button>
      <PrescriptionCompareDialog view={compareView(compareOpen)} phase="dispense" />
    </>
  );
}

describe('PrescriptionCompareDialog', () => {
  afterEach(() => {
    act(() => {
      useWorkbenchStore.setState({ compareOpen: false });
    });
  });

  it('closes on Escape even when focus leaves the dialog card', async () => {
    act(() => {
      useWorkbenchStore.setState({ compareOpen: true });
    });

    render(<CompareDialogHarness />);

    expect(screen.getByRole('dialog', { name: /前回処方との比較/ })).toBeTruthy();

    fireEvent.keyDown(document, { key: 'Escape' });

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: /前回処方との比較/ })).toBeNull();
    });
    expect(useWorkbenchStore.getState().compareOpen).toBe(false);
  });

  it('returns focus to the comparison trigger after Escape closes the dialog', async () => {
    render(<CompareDialogHarness />);

    const trigger = screen.getByRole('button', { name: '比較を開く' });
    trigger.focus();
    fireEvent.click(trigger);

    const closeButton = await screen.findByRole('button', { name: '閉じる' });
    expect(document.activeElement).toBe(closeButton);

    fireEvent.keyDown(document, { key: 'Escape' });

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: /前回処方との比較/ })).toBeNull();
    });
    expect(document.activeElement).toBe(trigger);
  });

  it('keeps Tab and Shift+Tab within the comparison dialog', async () => {
    render(<CompareDialogHarness />);

    fireEvent.click(screen.getByRole('button', { name: '比較を開く' }));

    const closeButton = await screen.findByRole('button', { name: '閉じる' });
    expect(document.activeElement).toBe(closeButton);

    fireEvent.keyDown(closeButton, { key: 'Tab' });
    expect(document.activeElement).toBe(closeButton);

    fireEvent.keyDown(closeButton, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(closeButton);
  });

  it('keeps comparison counts and supplemental medication text at the 12px minimum', () => {
    act(() => {
      useWorkbenchStore.setState({ compareOpen: true });
    });

    render(<CompareDialogHarness />);

    expect(screen.getByText('継続 1 ・ 新規 0 ・ 変更 0 ・ 中止 0').style.fontSize).toBe('12px');
    expect(screen.getByText('前回と同じ').style.fontSize).toBe('12px');
  });
});
