import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { NextRequest } from 'next/server';

const RESCHEDULE_URL = 'http://localhost/api/visit-schedules/schedule_1/reschedule';

export function createRescheduleRequest(body: unknown, headers?: Record<string, string>) {
  return new NextRequest(RESCHEDULE_URL, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
  });
}

export function createMalformedRescheduleRequest(headers?: Record<string, string>) {
  return new NextRequest(RESCHEDULE_URL, {
    method: 'POST',
    body: '{"reason":',
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
  });
}

export function buildExpectedRescheduleRequestIntentKey(args?: {
  reason?: string;
  reasonCode?: string;
  communicationChannel?: string;
  communicationResult?: string;
  startDate?: string | null;
  priority?: string | null;
  preferredPharmacistId?: string | null;
  requestedVehicleResourceId?: string | null;
}) {
  const material = [
    'visit-reschedule',
    'schedule_1',
    (args?.reason ?? '患者都合で変更').trim().replace(/\s+/g, ' '),
    args?.reasonCode ?? 'patient_request',
    args?.communicationChannel ?? 'phone',
    args?.communicationResult ?? 'pending',
    args?.startDate ?? '',
    args?.priority ?? '',
    args?.preferredPharmacistId ?? '',
    args?.requestedVehicleResourceId ?? '',
  ].join(':');
  return `visit-reschedule:v1:${createHash('sha256').update(material).digest('hex')}`;
}

export function buildSchedule(overrides?: Record<string, unknown>) {
  return {
    id: 'schedule_1',
    case_id: 'case_1',
    cycle_id: 'cycle_1',
    site_id: 'site_1',
    visit_type: 'regular',
    priority: 'normal',
    scheduled_date: new Date('2026-03-27T00:00:00.000Z'),
    time_window_start: new Date('1970-01-01T09:00:00.000Z'),
    time_window_end: new Date('1970-01-01T10:00:00.000Z'),
    pharmacist_id: 'user_1',
    assignment_mode: 'primary',
    route_order: 1,
    vehicle_resource_id: 'vehicle_1',
    schedule_status: 'planned',
    confirmed_at: new Date('2026-03-25T10:00:00.000Z'),
    confirmed_by: 'user_1',
    version: 4,
    case_: {
      patient_id: 'patient_1',
      patient: { name: '山田花子' },
    },
    ...overrides,
  };
}

export function buildImpactedSchedule(overrides?: Record<string, unknown>) {
  return {
    id: 'schedule_2',
    case_id: 'case_2',
    cycle_id: 'cycle_2',
    site_id: 'site_1',
    visit_type: 'regular',
    priority: 'normal',
    scheduled_date: new Date('2026-03-27T00:00:00.000Z'),
    time_window_start: new Date('1970-01-01T10:00:00.000Z'),
    time_window_end: new Date('1970-01-01T11:00:00.000Z'),
    pharmacist_id: 'user_1',
    assignment_mode: 'primary',
    route_order: 2,
    vehicle_resource_id: 'vehicle_2',
    schedule_status: 'planned',
    confirmed_at: new Date('2026-03-25T11:00:00.000Z'),
    confirmed_by: 'user_2',
    version: 2,
    override_request: null,
    case_: {
      patient_id: 'patient_2',
      patient: { name: '佐藤次郎' },
    },
    ...overrides,
  };
}

export function buildSerializableConflictError() {
  return new Prisma.PrismaClientKnownRequestError('Serializable transaction conflict', {
    code: 'P2034',
    clientVersion: 'test',
  });
}
