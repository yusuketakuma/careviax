// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';

const cardWorkspaceMock = vi.hoisted(() => vi.fn());
const cardWorkspaceMockState = vi.hoisted(() => ({
  suspend: false,
  promise: new Promise(() => undefined),
}));

vi.mock('@/lib/auth/config', () => ({
  auth: vi.fn(async () => null),
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {},
}));

vi.mock('@/lib/auth/user-resolution', () => ({
  resolveLocalUserByIdentity: vi.fn(),
}));

vi.mock('@/server/services/patient-detail', () => ({
  getPatientOverview: vi.fn(),
}));

vi.mock('./card-workspace', () => ({
  CardWorkspace: (props: { patientId: string; initialPatient: unknown }) => {
    cardWorkspaceMock(props);
    if (cardWorkspaceMockState.suspend) {
      throw cardWorkspaceMockState.promise;
    }
    return <section data-testid="card-workspace" />;
  },
}));

import PatientDetailPage from './page';

setupDomTestEnv();

describe('PatientDetailPage', () => {
  beforeEach(() => {
    cardWorkspaceMock.mockClear();
    cardWorkspaceMockState.suspend = false;
  });

  async function renderPage() {
    const page = await PatientDetailPage({ params: Promise.resolve({ id: 'patient_1' }) });
    return render(page);
  }

  it('renders the card workspace with route params', async () => {
    await renderPage();

    expect(screen.getByTestId('card-workspace')).toBeTruthy();
    expect(cardWorkspaceMock).toHaveBeenCalledWith(
      expect.objectContaining({ patientId: 'patient_1', initialPatient: null }),
    );
  });

  it('uses a screen-specific loading status for the route shell fallback', async () => {
    cardWorkspaceMockState.suspend = true;

    await renderPage();

    expect(screen.getByRole('status', { name: '患者カードを読み込み中...' })).toBeTruthy();
    expect(screen.queryByRole('status', { name: '読み込み中...' })).toBeNull();
    expect(screen.queryByTestId('card-workspace')).toBeNull();
  });
});
