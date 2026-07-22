import { expect, vi } from 'vitest';
import type { Prisma } from '@prisma/client';
import type { ScopedTxRunner } from '@/lib/db/rls';

/**
 * In-process ScopedTxRunner that runs work directly against the injected mock.
 */
export const runnerFor =
  (db: unknown): ScopedTxRunner =>
  (work) =>
    work(db as Prisma.TransactionClient);

export function buildDb<T extends Record<string, unknown> = Record<string, never>>(overrides?: T) {
  return {
    patient: {
      findFirst: vi.fn(),
    },
    careCase: {
      findFirst: vi.fn().mockResolvedValue(null),
    },
    task: {
      count: vi.fn().mockResolvedValue(0),
      findMany: vi.fn().mockResolvedValue([]),
    },
    consentRecord: {
      findFirst: vi.fn(),
    },
    managementPlan: {
      findFirst: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
    },
    prescriptionIntake: {
      findFirst: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
    },
    firstVisitDocument: {
      findFirst: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
    },
    template: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    visitSchedule: {
      count: vi.fn().mockResolvedValue(0),
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
    },
    visitRecord: {
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
    },
    careReport: { findMany: vi.fn().mockResolvedValue([]) },
    auditLog: { findMany: vi.fn().mockResolvedValue([]) },
    communicationEvent: { findMany: vi.fn().mockResolvedValue([]) },
    patientMcsMessage: { findMany: vi.fn().mockResolvedValue([]) },
    partnerVisitRecord: { findMany: vi.fn().mockResolvedValue([]) },
    residualMedication: { findMany: vi.fn().mockResolvedValue([]) },
    medicationStockSnapshot: { findMany: vi.fn().mockResolvedValue([]) },
    patientSelfReport: { findMany: vi.fn().mockResolvedValue([]) },
    externalAccessGrant: { findMany: vi.fn().mockResolvedValue([]) },
    inquiryRecord: { findMany: vi.fn().mockResolvedValue([]) },
    dispenseResult: { findMany: vi.fn().mockResolvedValue([]) },
    conferenceNote: { findMany: vi.fn().mockResolvedValue([]) },
    billingCandidate: { findMany: vi.fn().mockResolvedValue([]) },
    medicationCycle: {
      findMany: vi.fn().mockResolvedValue([]),
      // buildPatientWorkspace(06_card 集約): 進行中サイクルなし → workspace は null
      findFirst: vi.fn().mockResolvedValue(null),
    },
    patientLabObservation: {
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
    },
    patientInsurance: { findMany: vi.fn().mockResolvedValue([]) },
    patientFieldRevision: { findMany: vi.fn().mockResolvedValue([]) },
    jahisSupplementalRecord: { findMany: vi.fn().mockResolvedValue([]) },
    user: { findMany: vi.fn().mockResolvedValue([]) },
    // first_visit_document の操作履歴は ROW_NUMBER() window query (raw SQL) で取得する。
    $queryRaw: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

type ConsoleErrorSpy = { mock: { calls: unknown[][] } };

function parseConsoleErrorJson(spy: ConsoleErrorSpy) {
  return spy.mock.calls.flatMap((call) => {
    const [line] = call;
    if (typeof line !== 'string') return [];
    try {
      return [JSON.parse(line) as Record<string, unknown>];
    } catch {
      return [];
    }
  });
}

export function expectPatientTimelineFailureLog(spy: ConsoleErrorSpy, operation: string): void {
  expect(parseConsoleErrorJson(spy)).toContainEqual(
    expect.objectContaining({
      level: 'error',
      message: 'patient_timeline_source_query_failed',
      service: 'ph-os',
      event: 'patient_timeline_source_query_failed',
      orgId: 'org_1',
      operation,
      error_name: 'Error',
    }),
  );
}
