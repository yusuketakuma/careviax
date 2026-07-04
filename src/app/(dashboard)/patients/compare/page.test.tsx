// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';

const compareBoardMock = vi.hoisted(() => vi.fn());
const compareBoardMockState = vi.hoisted(() => ({
  suspend: false,
  promise: new Promise(() => undefined),
}));

vi.mock('./compare-board', () => ({
  CompareBoard: (props: { requestedPatientIds: string[] }) => {
    compareBoardMock(props);
    if (compareBoardMockState.suspend) {
      throw compareBoardMockState.promise;
    }
    return <section data-testid="compare-board" />;
  },
}));

import PatientsComparePage from './page';

setupDomTestEnv();

describe('PatientsComparePage', () => {
  beforeEach(() => {
    compareBoardMock.mockClear();
    compareBoardMockState.suspend = false;
  });

  async function renderPage() {
    const page = await PatientsComparePage({
      searchParams: Promise.resolve({ patients: 'patient_1,patient_2' }),
    });
    return render(page);
  }

  it('renders the compare board with parsed patient params', async () => {
    await renderPage();

    expect(screen.getByTestId('compare-board')).toBeTruthy();
    expect(compareBoardMock).toHaveBeenCalledWith(
      expect.objectContaining({ requestedPatientIds: ['patient_1', 'patient_2'] }),
    );
  });

  it('uses a screen-specific loading status for the route shell fallback', async () => {
    compareBoardMockState.suspend = true;

    await renderPage();

    expect(screen.getByRole('status', { name: '患者カード比較を読み込み中...' })).toBeTruthy();
    expect(screen.queryByRole('status', { name: '読み込み中...' })).toBeNull();
    expect(screen.queryByTestId('compare-board')).toBeNull();
  });
});
