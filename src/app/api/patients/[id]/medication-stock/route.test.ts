import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  authContextMock,
  authRejectionMock,
  createScopedTxRunnerMock,
  fakeRunner,
  getPatientMedicationStockSummaryMock,
  recordPhiReadAuditForRequestMock,
} = vi.hoisted(() => {
  const runner = vi.fn((work: (tx: unknown) => unknown) => work({ tx: true }));
  return {
    authContextMock: vi.fn(() => ({
      orgId: 'org_1',
      role: 'pharmacist',
      userId: 'user_1',
    })),
    authRejectionMock: vi.fn<() => Response | null>(() => null),
    createScopedTxRunnerMock: vi.fn(() => runner),
    fakeRunner: runner,
    getPatientMedicationStockSummaryMock: vi.fn(),
    recordPhiReadAuditForRequestMock: vi.fn(),
  };
});

vi.mock('@/lib/auth/context', () => ({
  withAuthContext:
    (handler: (...args: unknown[]) => Promise<Response>) =>
    (req: Request, routeContext: { params: Promise<{ id: string }> }) => {
      const rejection = authRejectionMock();
      if (rejection) return Promise.resolve(rejection);
      return handler(req, authContextMock(), routeContext);
    },
}));

vi.mock('@/lib/db/rls', () => ({
  createScopedTxRunner: createScopedTxRunnerMock,
}));

vi.mock('@/lib/audit/phi-read-audit', () => ({
  recordPhiReadAuditForRequest: recordPhiReadAuditForRequestMock,
}));

vi.mock('@/modules/pharmacy', () => ({
  getPatientMedicationStockSummary: getPatientMedicationStockSummaryMock,
}));

import { GET } from './route';

const jsonPayloadBytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;

function createRequest(url = 'http://localhost/api/patients/patient_1/medication-stock') {
  return new NextRequest(url);
}

describe('GET /api/patients/[id]/medication-stock', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authContextMock.mockReturnValue({ orgId: 'org_1', role: 'pharmacist', userId: 'user_1' });
    authRejectionMock.mockReturnValue(null);
    createScopedTxRunnerMock.mockReturnValue(fakeRunner);
    fakeRunner.mockImplementation((work: (tx: unknown) => unknown) => work({ tx: true }));
  });

  it('returns the medication stock summary through an org-scoped runner with no-store headers', async () => {
    getPatientMedicationStockSummaryMock.mockResolvedValue({
      data: {
        patient_id: 'patient_1',
        summary: {
          visible_item_count: 1,
        },
        items: [],
        recent_events: [{ id: 'event_1' }],
      },
      meta: {
        generated_at: '2026-07-07T00:00:00.000Z',
        item_limit: 50,
        event_limit: 12,
        visible_count: 1,
        hidden_count: 0,
        count_basis: 'limited_items',
        partial_failures: [],
      },
    });

    const response = await GET(createRequest(), {
      params: Promise.resolve({ id: 'patient_1' }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    const payload = await response.json();
    expect(response.headers.get('Content-Length')).toBe(String(jsonPayloadBytes(payload)));
    expect(payload.meta).toMatchObject({
      generated_at: '2026-07-07T00:00:00.000Z',
      item_limit: 50,
      event_limit: 12,
      visible_count: 1,
      hidden_count: 0,
      count_basis: 'limited_items',
      partial_failures: [],
    });
    expect(createScopedTxRunnerMock).toHaveBeenCalledWith('org_1');
    expect(getPatientMedicationStockSummaryMock).toHaveBeenCalledWith(
      { tx: true },
      {
        orgId: 'org_1',
        patientId: 'patient_1',
        role: 'pharmacist',
        userId: 'user_1',
        itemLimit: 50,
        eventLimit: 12,
      },
    );
    expect(recordPhiReadAuditForRequestMock).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: 'org_1', userId: 'user_1' }),
      {
        patientId: 'patient_1',
        view: 'patient_medication_stock',
        metadata: {
          visible_item_count: 1,
          recent_event_count: 1,
        },
      },
    );
  });

  it('passes bounded item and event limits to the summary service', async () => {
    getPatientMedicationStockSummaryMock.mockResolvedValue({
      data: {
        patient_id: 'patient_1',
        summary: { visible_item_count: 0 },
        items: [],
        recent_events: [],
      },
      meta: {
        generated_at: '2026-07-07T00:00:00.000Z',
        item_limit: 5,
        event_limit: 0,
        visible_count: 0,
        hidden_count: 0,
        count_basis: 'limited_items',
        partial_failures: [],
      },
    });

    const response = await GET(
      createRequest(
        'http://localhost/api/patients/patient_1/medication-stock?item_limit=5&event_limit=0',
      ),
      {
        params: Promise.resolve({ id: 'patient_1' }),
      },
    );

    expect(response.status).toBe(200);
    expect(getPatientMedicationStockSummaryMock).toHaveBeenCalledWith(
      { tx: true },
      expect.objectContaining({
        itemLimit: 5,
        eventLimit: 0,
      }),
    );
  });

  it('rejects invalid limits before building the scoped runner', async () => {
    const response = await GET(
      createRequest('http://localhost/api/patients/patient_1/medication-stock?item_limit=101'),
      {
        params: Promise.resolve({ id: 'patient_1' }),
      },
    );

    expect(response.status).toBe(400);
    expect(createScopedTxRunnerMock).not.toHaveBeenCalled();
    expect(getPatientMedicationStockSummaryMock).not.toHaveBeenCalled();
  });

  it('rejects blank patient ids before DB reads', async () => {
    const response = await GET(createRequest(), {
      params: Promise.resolve({ id: '   ' }),
    });

    expect(response.status).toBe(400);
    expect(createScopedTxRunnerMock).not.toHaveBeenCalled();
    expect(getPatientMedicationStockSummaryMock).not.toHaveBeenCalled();
  });

  it('returns 404 without PHI audit when the patient is not visible', async () => {
    getPatientMedicationStockSummaryMock.mockResolvedValue(null);

    const response = await GET(createRequest(), {
      params: Promise.resolve({ id: 'patient_1' }),
    });

    expect(response.status).toBe(404);
    expect(recordPhiReadAuditForRequestMock).not.toHaveBeenCalled();
  });

  it('returns a no-store internal error without PHI audit when the summary read fails', async () => {
    getPatientMedicationStockSummaryMock.mockRejectedValueOnce(new Error('database unavailable'));

    const response = await GET(createRequest(), {
      params: Promise.resolve({ id: 'patient_1' }),
    });
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(JSON.stringify(payload)).not.toContain('database unavailable');
    expect(recordPhiReadAuditForRequestMock).not.toHaveBeenCalled();
  });
});
