// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';

const collaborationContentMock = vi.hoisted(() => vi.fn());
const collaborationContentMockState = vi.hoisted(() => ({
  suspend: false,
  promise: new Promise(() => undefined),
}));

vi.mock('./collaboration-content', () => ({
  CollaborationContent: (props: { patientId: string }) => {
    collaborationContentMock(props);
    if (collaborationContentMockState.suspend) {
      throw collaborationContentMockState.promise;
    }
    return <section data-testid="collaboration-content" />;
  },
}));

import PatientCollaborationPage from './page';

setupDomTestEnv();

describe('PatientCollaborationPage', () => {
  beforeEach(() => {
    collaborationContentMock.mockClear();
    collaborationContentMockState.suspend = false;
  });

  async function renderPage() {
    const page = await PatientCollaborationPage({ params: Promise.resolve({ id: 'patient_1' }) });
    return render(page);
  }

  it('renders collaboration content with route params', async () => {
    await renderPage();

    expect(screen.getByTestId('collaboration-content')).toBeTruthy();
    expect(collaborationContentMock).toHaveBeenCalledWith(
      expect.objectContaining({ patientId: 'patient_1' }),
    );
  });

  it('uses a screen-specific loading status for the route shell fallback', async () => {
    collaborationContentMockState.suspend = true;

    await renderPage();

    expect(screen.getByRole('status', { name: '共同編集状況を読み込み中...' })).toBeTruthy();
    expect(screen.queryByRole('status', { name: '読み込み中...' })).toBeNull();
    expect(screen.queryByTestId('collaboration-content')).toBeNull();
  });
});
