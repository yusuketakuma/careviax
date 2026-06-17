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
  return <PrescriptionCompareDialog view={compareView(compareOpen)} phase="dispense" />;
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
});
