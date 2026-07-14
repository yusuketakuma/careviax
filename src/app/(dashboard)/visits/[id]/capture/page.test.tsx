// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';

const {
  authMock,
  resolveLocalUserByIdentityMock,
  hasPermissionMock,
  buildVisitScheduleAssignmentWhereMock,
  canAccessVisitScheduleAssignmentMock,
  recordPhiReadAuditForRequestMock,
  membershipFindFirstMock,
  visitScheduleFindFirstMock,
  transactionClient,
  withOrgContextMock,
  captureContentCalls,
} = vi.hoisted(() => ({
  authMock: vi.fn(),
  resolveLocalUserByIdentityMock: vi.fn(),
  hasPermissionMock: vi.fn(),
  buildVisitScheduleAssignmentWhereMock: vi.fn(),
  canAccessVisitScheduleAssignmentMock: vi.fn(),
  recordPhiReadAuditForRequestMock: vi.fn(),
  membershipFindFirstMock: vi.fn(),
  visitScheduleFindFirstMock: vi.fn(),
  transactionClient: {
    visitSchedule: { findFirst: vi.fn() },
  },
  withOrgContextMock: vi.fn(),
  captureContentCalls: [] as Array<{ visitId: string; initialPatientContext: unknown }>,
}));

vi.mock('@/lib/auth/config', () => ({ auth: authMock }));
vi.mock('@/lib/auth/user-resolution', () => ({
  resolveLocalUserByIdentity: resolveLocalUserByIdentityMock,
}));
vi.mock('@/lib/auth/permissions', () => ({ hasPermission: hasPermissionMock }));
vi.mock('@/lib/auth/visit-schedule-access', () => ({
  buildVisitScheduleAssignmentWhere: buildVisitScheduleAssignmentWhereMock,
  canAccessVisitScheduleAssignment: canAccessVisitScheduleAssignmentMock,
}));
vi.mock('@/lib/audit/phi-read-audit', () => ({
  recordPhiReadAuditForRequest: recordPhiReadAuditForRequestMock,
}));
vi.mock('@/lib/db/client', () => ({
  prisma: {
    membership: { findFirst: membershipFindFirstMock },
  },
}));
vi.mock('@/lib/db/rls', () => ({ withOrgContext: withOrgContextMock }));
vi.mock('./capture-content', () => ({
  EvidenceCaptureContent: (props: { visitId: string; initialPatientContext: unknown }) => {
    captureContentCalls.push(props);
    return <section data-testid="evidence-capture-content" />;
  },
}));

import VisitEvidenceCapturePage from './page';

setupDomTestEnv();

describe('VisitEvidenceCapturePage initial patient context authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    captureContentCalls.length = 0;
    authMock.mockResolvedValue({ user: { email: 'pharmacist@example.test' } });
    resolveLocalUserByIdentityMock.mockResolvedValue({
      id: 'user_1',
      org_id: 'org_1',
      default_site_id: 'site_1',
    });
    membershipFindFirstMock.mockResolvedValue({ role: 'pharmacist' });
    hasPermissionMock.mockReturnValue(true);
    buildVisitScheduleAssignmentWhereMock.mockReturnValue(null);
    canAccessVisitScheduleAssignmentMock.mockReturnValue(true);
    transactionClient.visitSchedule.findFirst = visitScheduleFindFirstMock;
    withOrgContextMock.mockImplementation(
      async (_orgId: string, work: (tx: typeof transactionClient) => Promise<unknown>) =>
        work(transactionClient),
    );
    visitScheduleFindFirstMock.mockResolvedValue({
      pharmacist_id: 'user_1',
      scheduled_date: new Date('2026-04-09T00:00:00.000Z'),
      time_window_start: new Date('1970-01-01T10:30:00.000Z'),
      case_: {
        primary_pharmacist_id: 'user_1',
        backup_pharmacist_id: null,
        patient: { id: 'patient_1', name: '田中 一郎' },
      },
      visit_record: {
        id: 'record_1',
        version: 2,
        visit_started_at: new Date('2026-04-09T01:00:00.000Z'),
        visit_ended_at: null,
      },
    });
  });

  async function renderPage() {
    render(await VisitEvidenceCapturePage({ params: Promise.resolve({ id: 'schedule_1' }) }));
  }

  it('hydrates the capture UI only after permission and assignment checks pass', async () => {
    await renderPage();

    expect(screen.getByTestId('evidence-capture-content')).toBeTruthy();
    expect(membershipFindFirstMock).toHaveBeenCalledWith({
      where: { user_id: 'user_1', org_id: 'org_1', is_active: true },
      select: { role: true },
    });
    expect(hasPermissionMock).toHaveBeenCalledWith('pharmacist', 'canVisit');
    expect(withOrgContextMock).toHaveBeenCalledWith('org_1', expect.any(Function), {
      requestContext: {
        orgId: 'org_1',
        userId: 'user_1',
        role: 'pharmacist',
        actorSiteId: 'site_1',
      },
    });
    expect(canAccessVisitScheduleAssignmentMock).toHaveBeenCalledWith(
      { userId: 'user_1', role: 'pharmacist' },
      expect.objectContaining({ pharmacist_id: 'user_1' }),
    );
    expect(recordPhiReadAuditForRequestMock).toHaveBeenCalledWith(
      {
        orgId: 'org_1',
        userId: 'user_1',
        role: 'pharmacist',
        actorSiteId: 'site_1',
      },
      { patientId: 'patient_1', view: 'visit_evidence_capture' },
    );
    expect(captureContentCalls).toContainEqual({
      visitId: 'schedule_1',
      initialPatientContext: {
        patientId: 'patient_1',
        patientName: '田中 一郎',
        visitDateTimeLabel: '4月9日 10:30',
        visitRecordId: 'record_1',
        visitRecordVersion: 2,
        visitStartedAt: '2026-04-09T01:00:00.000Z',
        visitEndedAt: null,
      },
    });
  });

  it('does not query or expose schedule PHI when canVisit is missing', async () => {
    membershipFindFirstMock.mockResolvedValueOnce({ role: 'driver' });
    hasPermissionMock.mockReturnValueOnce(false);

    await renderPage();

    expect(visitScheduleFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(recordPhiReadAuditForRequestMock).not.toHaveBeenCalled();
    expect(captureContentCalls).toContainEqual({
      visitId: 'schedule_1',
      initialPatientContext: null,
    });
  });

  it('applies the same assignment scope as the visit schedule API before selecting PHI', async () => {
    const assignmentWhere = { OR: [{ pharmacist_id: 'trainee_1' }] };
    resolveLocalUserByIdentityMock.mockResolvedValueOnce({ id: 'trainee_1', org_id: 'org_1' });
    membershipFindFirstMock.mockResolvedValueOnce({ role: 'pharmacist_trainee' });
    buildVisitScheduleAssignmentWhereMock.mockReturnValueOnce(assignmentWhere);
    visitScheduleFindFirstMock.mockResolvedValueOnce(null);

    await renderPage();

    expect(buildVisitScheduleAssignmentWhereMock).toHaveBeenCalledWith({
      userId: 'trainee_1',
      role: 'pharmacist_trainee',
    });
    expect(visitScheduleFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'schedule_1', org_id: 'org_1', AND: [assignmentWhere] },
      }),
    );
    expect(canAccessVisitScheduleAssignmentMock).not.toHaveBeenCalled();
    expect(recordPhiReadAuditForRequestMock).not.toHaveBeenCalled();
    expect(captureContentCalls).toContainEqual({
      visitId: 'schedule_1',
      initialPatientContext: null,
    });
  });

  it('keeps the SSR context empty if the defense-in-depth assignment check rejects the row', async () => {
    canAccessVisitScheduleAssignmentMock.mockReturnValueOnce(false);

    await renderPage();

    expect(recordPhiReadAuditForRequestMock).not.toHaveBeenCalled();
    expect(captureContentCalls).toContainEqual({
      visitId: 'schedule_1',
      initialPatientContext: null,
    });
  });

  it('does not audit or render capture context when the transaction-scoped query throws', async () => {
    visitScheduleFindFirstMock.mockRejectedValueOnce(new Error('database unavailable'));

    await expect(
      VisitEvidenceCapturePage({ params: Promise.resolve({ id: 'schedule_1' }) }),
    ).rejects.toThrow('database unavailable');

    expect(withOrgContextMock).toHaveBeenCalledOnce();
    expect(visitScheduleFindFirstMock).toHaveBeenCalledOnce();
    expect(canAccessVisitScheduleAssignmentMock).not.toHaveBeenCalled();
    expect(recordPhiReadAuditForRequestMock).not.toHaveBeenCalled();
    expect(captureContentCalls).toHaveLength(0);
  });
});
