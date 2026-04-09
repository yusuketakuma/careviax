import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const {
  getPatientOverviewMock,
  getPatientVisitsDataMock,
  getPatientCommunicationsDataMock,
  getPatientDocumentsDataMock,
  getPatientTimelineDataMock,
  getPatientReadinessDataMock,
} = vi.hoisted(() => ({
  getPatientOverviewMock: vi.fn(),
  getPatientVisitsDataMock: vi.fn(),
  getPatientCommunicationsDataMock: vi.fn(),
  getPatientDocumentsDataMock: vi.fn(),
  getPatientTimelineDataMock: vi.fn(),
  getPatientReadinessDataMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  withAuthContext:
    (handler: (...args: unknown[]) => Promise<Response>) =>
    (req: Request, routeContext: { params: Promise<{ id: string }> }) =>
      handler(
        req,
        {
          orgId: 'org_1',
          role: 'pharmacist',
          userId: 'user_1',
        },
        routeContext
      ),
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {},
}));

vi.mock('@/server/services/patient-detail', () => ({
  getPatientOverview: getPatientOverviewMock,
  getPatientVisitsData: getPatientVisitsDataMock,
  getPatientCommunicationsData: getPatientCommunicationsDataMock,
  getPatientDocumentsData: getPatientDocumentsDataMock,
  getPatientTimelineData: getPatientTimelineDataMock,
  getPatientReadinessData: getPatientReadinessDataMock,
}));

import { GET as overviewGet } from './overview/route';
import { GET as visitsGet } from './visits/route';
import { GET as communicationsGet } from './communications/route';
import { GET as documentsGet } from './documents/route';
import { GET as timelineGet } from './timeline/route';
import { GET as readinessGet } from './readiness/route';

function createRequest(url: string) {
  return { url } as unknown as NextRequest;
}

describe('patient detail slice routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns patient overview data', async () => {
    getPatientOverviewMock.mockResolvedValue({ id: 'patient_1', name: '患者A' });

    const response = await overviewGet(createRequest('http://localhost/api/patients/patient_1/overview'), {
      params: Promise.resolve({ id: 'patient_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(getPatientOverviewMock).toHaveBeenCalledWith({}, {
      orgId: 'org_1',
      patientId: 'patient_1',
      role: 'pharmacist',
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ id: 'patient_1' });
  });

  it('returns patient visits data', async () => {
    getPatientVisitsDataMock.mockResolvedValue({ monthly_visit_count: 2 });

    const response = await visitsGet(createRequest('http://localhost/api/patients/patient_1/visits'), {
      params: Promise.resolve({ id: 'patient_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ monthly_visit_count: 2 });
  });

  it('returns patient communications data', async () => {
    getPatientCommunicationsDataMock.mockResolvedValue({
      communication_queue: { summary: { pending_count: 1 } },
    });

    const response = await communicationsGet(
      createRequest('http://localhost/api/patients/patient_1/communications'),
      { params: Promise.resolve({ id: 'patient_1' }) }
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      communication_queue: { summary: { pending_count: 1 } },
    });
  });

  it('returns patient documents data', async () => {
    getPatientDocumentsDataMock.mockResolvedValue({
      first_visit_documents: [],
    });

    const response = await documentsGet(
      createRequest('http://localhost/api/patients/patient_1/documents'),
      { params: Promise.resolve({ id: 'patient_1' }) }
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ first_visit_documents: [] });
  });

  it('returns patient timeline data', async () => {
    getPatientTimelineDataMock.mockResolvedValue({
      timeline_events: [],
      self_reports: [],
    });

    const response = await timelineGet(
      createRequest('http://localhost/api/patients/patient_1/timeline'),
      { params: Promise.resolve({ id: 'patient_1' }) }
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      timeline_events: [],
      self_reports: [],
    });
  });

  it('returns patient readiness data', async () => {
    getPatientReadinessDataMock.mockResolvedValue({
      applicable: true,
      overall_status: 'ready',
      completed_count: 6,
      total_count: 6,
      current_case: { id: 'case_1', status: 'active' },
      items: [],
    });

    const response = await readinessGet(
      createRequest('http://localhost/api/patients/patient_1/readiness'),
      { params: Promise.resolve({ id: 'patient_1' }) }
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      overall_status: 'ready',
      completed_count: 6,
    });
  });
});
