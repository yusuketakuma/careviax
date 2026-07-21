import { NextRequest } from 'next/server';
import type { Mock } from 'vitest';

type RouteTargetFixture = {
  id: string;
  case_id?: string;
  site_id?: string | null;
  site?: { id: string; name: string; lat: number | null; lng: number | null } | null;
  case_?: {
    patient: {
      name: string;
      residences: Array<{ address: string; lat: number | null; lng: number | null }>;
    };
  };
};

export function createVisitRouteRequest(body: unknown) {
  return new NextRequest('http://localhost/api/visit-routes', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-org-id': 'org_1' },
    body: JSON.stringify(body),
  });
}

export function createMalformedVisitRouteRequest() {
  return new NextRequest('http://localhost/api/visit-routes', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-org-id': 'org_1' },
    body: '{',
  });
}

export function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

export function installVisitRouteContextMock(args: {
  withOrgContext: Mock;
  scheduleFindMany: Mock;
  proposalFindMany: Mock;
  vehicleResourceFindFirst: Mock;
}) {
  args.withOrgContext.mockImplementation(async (_orgId, callback) => {
    const fixtures: RouteTargetFixture[] = [];
    const registerFixtures = (rows: RouteTargetFixture[]) => {
      fixtures.push(...rows);
      return rows.map((row) => ({
        ...row,
        case_id: row.case_id ?? `case:${row.id}`,
        site_id: row.site_id ?? row.site?.id ?? null,
      }));
    };

    return callback({
      visitSchedule: {
        findMany: async (query: unknown) =>
          registerFixtures((await args.scheduleFindMany(query)) as RouteTargetFixture[]),
      },
      visitScheduleProposal: {
        findMany: async (query: unknown) =>
          registerFixtures((await args.proposalFindMany(query)) as RouteTargetFixture[]),
      },
      visitVehicleResource: { findFirst: args.vehicleResourceFindFirst },
      pharmacySite: {
        findMany: async () =>
          Array.from(
            new Map(
              fixtures.flatMap((row) => (row.site ? [[row.site.id, row.site]] : [])),
            ).values(),
          ),
      },
      careCase: {
        findMany: async () =>
          fixtures.map((row) => ({
            id: row.case_id ?? `case:${row.id}`,
            patient_id: `patient:${row.case_id ?? row.id}`,
          })),
      },
      patient: {
        findMany: async () =>
          fixtures.map((row) => ({
            id: `patient:${row.case_id ?? row.id}`,
            name: row.case_?.patient.name ?? '',
          })),
      },
      residence: {
        findMany: async () =>
          fixtures.flatMap((row) =>
            (row.case_?.patient.residences ?? []).map((residence) => ({
              patient_id: `patient:${row.case_id ?? row.id}`,
              ...residence,
            })),
          ),
      },
    });
  });
}
