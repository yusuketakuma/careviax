import { NextRequest } from 'next/server';
import { expect, type Mock } from 'vitest';

export type FacilityBatchRouteContext = { params: Promise<{ id: string }> };

export function createFacilityBatchDetailRequest(body?: unknown) {
  return new NextRequest('http://localhost/api/facility-visit-batches/batch_1', {
    method: body === undefined ? 'DELETE' : 'PATCH',
    ...(body === undefined
      ? {}
      : {
          headers: {
            'content-type': 'application/json',
          },
          body: JSON.stringify(body),
        }),
  });
}

export function createMalformedFacilityBatchPatchRequest() {
  return new NextRequest('http://localhost/api/facility-visit-batches/batch_1', {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
    },
    body: '{"ordered_schedule_ids":',
  });
}

export function facilityBatchRouteContext(id: string): FacilityBatchRouteContext {
  return { params: Promise.resolve({ id }) };
}

export function expectFacilityBatchDeleteUnlinkWrites(updateManyMock: Mock) {
  expect(updateManyMock).toHaveBeenCalledTimes(2);
  expect(updateManyMock).toHaveBeenNthCalledWith(1, {
    where: {
      id: 'schedule_1',
      org_id: 'org_1',
      facility_batch_id: 'batch_1',
      version: 7,
      schedule_status: { in: ['planned', 'in_preparation', 'ready', 'departed', 'in_progress'] },
      confirmed_at: null,
    },
    data: { facility_batch_id: null, route_order: null, version: { increment: 1 } },
  });
  expect(updateManyMock).toHaveBeenNthCalledWith(2, {
    where: {
      id: 'schedule_2',
      org_id: 'org_1',
      facility_batch_id: 'batch_1',
      version: 3,
      schedule_status: { in: ['planned', 'in_preparation', 'ready', 'departed', 'in_progress'] },
      confirmed_at: null,
    },
    data: { facility_batch_id: null, route_order: null, version: { increment: 1 } },
  });
}
