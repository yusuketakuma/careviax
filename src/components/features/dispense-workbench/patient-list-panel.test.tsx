// @vitest-environment jsdom

import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { PatientListPanel } from './patient-list-panel';
import { useWorkbenchStore } from './dispensing-workbench.store';
import type { WorkbenchView } from './dispensing-workbench.types';

const longPatientName = '山田太郎太郎太郎太郎太郎太郎太郎';
const initialStoreState = useWorkbenchStore.getState();

function patientListView(): WorkbenchView {
  return {
    listState: 'ready',
    patientCount: '1',
    sortButtons: [],
    patients: [
      {
        id: 'patient-long-name',
        name: longPatientName,
        startLabel: '7/11',
        registLabel: '7/1',
        age: '80歳',
        initial: '山',
        avatarBg: 'var(--wb-avatar-1)',
        bg: 'var(--wb-surface)',
        barColor: 'var(--wb-accent)',
        statusLabel: '未着手',
        statusColor: 'var(--wb-state-readonly)',
        selected: false,
      },
    ],
  } as unknown as WorkbenchView;
}

describe('PatientListPanel', () => {
  afterEach(() => {
    act(() => {
      useWorkbenchStore.setState(initialStoreState, true);
    });
  });

  it('keeps a long patient name readable while preserving row selection', () => {
    render(<PatientListPanel phase="dispense" view={patientListView()} />);

    const patientName = screen.getByText(longPatientName);
    const row = screen.getByTestId('dispense-queue-row');

    expect(patientName).toBeInstanceOf(HTMLDivElement);
    const patientNameStyle = (patientName as HTMLDivElement).style;
    expect(patientNameStyle.whiteSpace).toBe('');
    expect(patientNameStyle.overflow).toBe('');
    expect(patientNameStyle.textOverflow).toBe('');
    expect(patientNameStyle.overflowWrap).toBe('anywhere');
    expect(patientNameStyle.lineHeight).toBe('1.35');

    fireEvent.click(row);

    expect(useWorkbenchStore.getState().selId).toBe('patient-long-name');
  });
});
