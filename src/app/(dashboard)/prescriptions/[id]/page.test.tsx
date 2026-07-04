// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';

const prescriptionDetailContentMock = vi.hoisted(() => vi.fn());
const prescriptionDetailContentMockState = vi.hoisted(() => ({
  suspend: false,
  promise: new Promise(() => undefined),
}));

vi.mock('./prescription-detail-content', () => ({
  PrescriptionDetailContent: (props: { intakeId: string }) => {
    prescriptionDetailContentMock(props);
    if (prescriptionDetailContentMockState.suspend) {
      throw prescriptionDetailContentMockState.promise;
    }
    return <section data-testid="prescription-detail-content" />;
  },
}));

import PrescriptionDetailPage from './page';

setupDomTestEnv();

describe('PrescriptionDetailPage', () => {
  beforeEach(() => {
    prescriptionDetailContentMock.mockClear();
    prescriptionDetailContentMockState.suspend = false;
  });

  async function renderPage() {
    const page = await PrescriptionDetailPage({
      params: Promise.resolve({ id: 'intake_1' }),
    });
    return render(page);
  }

  it('renders the prescription detail content with route params', async () => {
    await renderPage();

    expect(screen.getByTestId('prescription-detail-content')).toBeTruthy();
    expect(prescriptionDetailContentMock).toHaveBeenCalledWith(
      expect.objectContaining({ intakeId: 'intake_1' }),
    );
  });

  it('uses a screen-specific loading status for the route shell fallback', async () => {
    prescriptionDetailContentMockState.suspend = true;

    await renderPage();

    expect(screen.getByRole('status', { name: '処方受付詳細を読み込み中...' })).toBeTruthy();
    expect(screen.queryByRole('status', { name: '読み込み中...' })).toBeNull();
    expect(screen.queryByTestId('prescription-detail-content')).toBeNull();
  });
});
