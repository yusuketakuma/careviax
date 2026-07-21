import { Prisma } from '@prisma/client';
import { NextRequest } from 'next/server';

const PROPOSAL_DETAIL_URL = 'http://localhost/api/visit-schedule-proposals/proposal_1';

export function createProposalDetailRequest(body?: unknown, headers?: Record<string, string>) {
  if (body === undefined) {
    return new NextRequest(PROPOSAL_DETAIL_URL, { headers });
  }

  return new NextRequest(PROPOSAL_DETAIL_URL, {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
  });
}

export function createMalformedProposalPatchRequest(headers?: Record<string, string>) {
  return new NextRequest(PROPOSAL_DETAIL_URL, {
    method: 'PATCH',
    body: '{"action":',
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
  });
}

export function buildProposal(overrides?: Record<string, unknown>) {
  return {
    id: 'proposal_1',
    display_id: 'vsp0000000001',
    org_id: 'org_1',
    case_id: 'case_1',
    cycle_id: 'cycle_1',
    site_id: 'site_1',
    visit_type: 'regular',
    priority: 'normal',
    proposal_status: 'proposed',
    patient_contact_status: 'pending',
    proposed_date: new Date('2026-03-27T00:00:00.000Z'),
    time_window_start: new Date('1970-01-01T09:00:00.000Z'),
    time_window_end: new Date('1970-01-01T10:00:00.000Z'),
    proposed_pharmacist_id: 'pharmacist_1',
    assignment_mode: 'primary',
    route_order: 1,
    vehicle_resource_id: null,
    vehicle_resource: null,
    created_at: new Date('2026-03-26T09:00:00.000Z'),
    updated_at: new Date('2026-03-26T09:15:00.000Z'),
    medication_end_date: new Date('2026-03-31T00:00:00.000Z'),
    visit_deadline_date: new Date('2026-03-30T00:00:00.000Z'),
    escalation_reason: null,
    suggested_recurrence_rule: null,
    finalized_schedule_id: null,
    reschedule_source_schedule_id: null,
    case_: {
      display_id: 'cc0000000001',
      patient_id: 'patient_1',
      required_visit_support: null,
      patient: {
        id: 'patient_1',
        display_id: 'p0000000001',
        name: '患者A',
        phone: '03-0000-0000',
        medical_insurance_number: 'MED-SECRET-1',
        care_insurance_number: 'CARE-SECRET-1',
        allergy_info: { freeText: 'アレルギー詳細' },
        notes: '患者メモ詳細',
        residences: [
          {
            address: '東京都千代田区1-1-1',
            building_id: '建物A',
            unit_name: '203号室',
            lat: 35.2,
            lng: 139.2,
            geocode_source: 'internal-geocoder',
          },
        ],
      },
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

export function buildUniqueConstraintError() {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
  });
}
