// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';

const {
  authMock,
  cardWorkspaceMock,
  cardWorkspaceMockState,
  getPatientOverviewMock,
  membershipFindFirstMock,
  recordPhiReadAuditForRequestMock,
  resolveLocalUserByIdentityMock,
  transactionClient,
  withOrgContextMock,
} = vi.hoisted(() => ({
  authMock: vi.fn(),
  cardWorkspaceMock: vi.fn(),
  cardWorkspaceMockState: {
    suspend: false,
    promise: new Promise(() => undefined),
  },
  getPatientOverviewMock: vi.fn(),
  membershipFindFirstMock: vi.fn(),
  recordPhiReadAuditForRequestMock: vi.fn(),
  resolveLocalUserByIdentityMock: vi.fn(),
  transactionClient: { scope: 'org_transaction' },
  withOrgContextMock: vi.fn(),
}));

vi.mock('@/lib/auth/config', () => ({
  auth: authMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    membership: { findFirst: membershipFindFirstMock },
  },
}));

vi.mock('@/lib/auth/user-resolution', () => ({
  resolveLocalUserByIdentity: resolveLocalUserByIdentityMock,
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/lib/audit/phi-read-audit', () => ({
  recordPhiReadAuditForRequest: recordPhiReadAuditForRequestMock,
}));

vi.mock('@/server/services/patient-detail', () => ({
  getPatientOverview: getPatientOverviewMock,
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
    vi.clearAllMocks();
    cardWorkspaceMockState.suspend = false;
    authMock.mockResolvedValue({ user: { email: 'pharmacist@example.test' } });
    resolveLocalUserByIdentityMock.mockResolvedValue({
      id: 'user_1',
      org_id: 'org_1',
    });
    membershipFindFirstMock.mockResolvedValue({ role: 'pharmacist' });
    getPatientOverviewMock.mockResolvedValue({
      id: 'patient_1',
      name: '患者 一郎',
      updated_at: new Date('2026-07-14T00:00:00.000Z'),
    });
    withOrgContextMock.mockImplementation(
      async (_orgId: string, work: (tx: typeof transactionClient) => Promise<unknown>) =>
        work(transactionClient),
    );
  });

  async function renderPage() {
    const page = await PatientDetailPage({ params: Promise.resolve({ id: 'patient_1' }) });
    return render(page);
  }

  it('reads the initial overview only through the org-scoped transaction and audits success', async () => {
    await renderPage();

    expect(screen.getByTestId('card-workspace')).toBeTruthy();
    expect(membershipFindFirstMock).toHaveBeenCalledWith({
      where: { user_id: 'user_1', org_id: 'org_1', is_active: true },
      select: { role: true },
    });
    expect(withOrgContextMock).toHaveBeenCalledWith('org_1', expect.any(Function), {
      requestContext: {
        orgId: 'org_1',
        userId: 'user_1',
        role: 'pharmacist',
      },
    });
    expect(getPatientOverviewMock).toHaveBeenCalledWith(transactionClient, {
      orgId: 'org_1',
      patientId: 'patient_1',
      role: 'pharmacist',
      userId: 'user_1',
    });
    expect(recordPhiReadAuditForRequestMock).toHaveBeenCalledWith(
      {
        orgId: 'org_1',
        userId: 'user_1',
        role: 'pharmacist',
      },
      { patientId: 'patient_1', view: 'patient_overview_ssr' },
    );
    expect(cardWorkspaceMock).toHaveBeenCalledWith(
      expect.objectContaining({
        patientId: 'patient_1',
        initialPatient: expect.objectContaining({
          id: 'patient_1',
          updated_at: '2026-07-14T00:00:00.000Z',
        }),
      }),
    );
  });

  it.each([
    ['owner', true],
    ['admin', true],
    ['pharmacist', true],
    ['pharmacist_trainee', true],
    ['clerk', false],
    ['driver', false],
    ['external_viewer', false],
  ] as const)('keeps SSR patient reads aligned with canVisit for %s', async (role, allowed) => {
    membershipFindFirstMock.mockResolvedValueOnce({ role });

    await renderPage();

    expect(withOrgContextMock).toHaveBeenCalledTimes(allowed ? 1 : 0);
    expect(getPatientOverviewMock).toHaveBeenCalledTimes(allowed ? 1 : 0);
    expect(recordPhiReadAuditForRequestMock).toHaveBeenCalledTimes(allowed ? 1 : 0);
    expect(cardWorkspaceMock).toHaveBeenCalledWith(
      expect.objectContaining({
        patientId: 'patient_1',
        initialPatient: allowed ? expect.objectContaining({ id: 'patient_1' }) : null,
      }),
    );
  });

  it('does not query patient PHI or audit when the session has no usable identity', async () => {
    authMock.mockResolvedValueOnce({ user: {} });

    await renderPage();

    expect(resolveLocalUserByIdentityMock).not.toHaveBeenCalled();
    expect(membershipFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(getPatientOverviewMock).not.toHaveBeenCalled();
    expect(recordPhiReadAuditForRequestMock).not.toHaveBeenCalled();
    expect(cardWorkspaceMock).toHaveBeenCalledWith(
      expect.objectContaining({ patientId: 'patient_1', initialPatient: null }),
    );
  });

  it('does not query patient PHI or audit when active membership is missing', async () => {
    membershipFindFirstMock.mockResolvedValueOnce(null);

    await renderPage();

    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(getPatientOverviewMock).not.toHaveBeenCalled();
    expect(recordPhiReadAuditForRequestMock).not.toHaveBeenCalled();
  });

  it('keeps missing and cross-org patient results empty and unaudited', async () => {
    getPatientOverviewMock.mockResolvedValueOnce(null);

    await renderPage();

    expect(getPatientOverviewMock).toHaveBeenCalledWith(
      transactionClient,
      expect.objectContaining({ orgId: 'org_1', patientId: 'patient_1' }),
    );
    expect(recordPhiReadAuditForRequestMock).not.toHaveBeenCalled();
    expect(cardWorkspaceMock).toHaveBeenCalledWith(
      expect.objectContaining({ patientId: 'patient_1', initialPatient: null }),
    );
  });

  it('does not write a read audit when the RLS-scoped patient query throws', async () => {
    withOrgContextMock.mockRejectedValueOnce(new Error('database unavailable'));

    await expect(
      PatientDetailPage({ params: Promise.resolve({ id: 'patient_1' }) }),
    ).rejects.toThrow('database unavailable');

    expect(recordPhiReadAuditForRequestMock).not.toHaveBeenCalled();
    expect(cardWorkspaceMock).not.toHaveBeenCalled();
  });

  it('uses a screen-specific loading status for the route shell fallback', async () => {
    cardWorkspaceMockState.suspend = true;

    await renderPage();

    expect(screen.getByRole('status', { name: '患者カードを読み込み中...' })).toBeTruthy();
    expect(screen.queryByRole('status', { name: '読み込み中...' })).toBeNull();
    expect(screen.queryByTestId('card-workspace')).toBeNull();
  });
});
