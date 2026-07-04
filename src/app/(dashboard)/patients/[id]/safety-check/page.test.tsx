// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';

const safetyCheckContentMock = vi.hoisted(() => vi.fn());
const safetyCheckContentMockState = vi.hoisted(() => ({
  suspend: false,
  promise: new Promise(() => undefined),
}));

vi.mock('./safety-check-content', () => ({
  SafetyCheckContent: (props: { patientId: string }) => {
    safetyCheckContentMock(props);
    if (safetyCheckContentMockState.suspend) {
      throw safetyCheckContentMockState.promise;
    }
    return <section data-testid="safety-check-content" />;
  },
}));

import SafetyCheckPage from './page';

setupDomTestEnv();

describe('SafetyCheckPage', () => {
  beforeEach(() => {
    safetyCheckContentMock.mockClear();
    safetyCheckContentMockState.suspend = false;
  });

  async function renderPage() {
    const page = await SafetyCheckPage({ params: Promise.resolve({ id: 'patient_1' }) });
    return render(page);
  }

  it('renders safety check content with route params', async () => {
    await renderPage();

    expect(screen.getByTestId('safety-check-content')).toBeTruthy();
    expect(safetyCheckContentMock).toHaveBeenCalledWith(
      expect.objectContaining({ patientId: 'patient_1' }),
    );
  });

  it('uses a screen-specific loading status for the route shell fallback', async () => {
    safetyCheckContentMockState.suspend = true;

    await renderPage();

    expect(screen.getByRole('status', { name: '薬の安全チェックを読み込み中...' })).toBeTruthy();
    expect(screen.queryByRole('status', { name: '読み込み中...' })).toBeNull();
    expect(screen.queryByTestId('safety-check-content')).toBeNull();
  });
});
