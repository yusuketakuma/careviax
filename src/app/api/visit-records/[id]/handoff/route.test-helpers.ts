import { NextRequest } from 'next/server';

export function createRequest(url: string, body?: unknown) {
  if (body === undefined) {
    return new NextRequest(url);
  }
  return new NextRequest(url, {
    method: 'PUT',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

export function createMalformedJsonRequest(url: string) {
  return new NextRequest(url, {
    method: 'PUT',
    body: '{"confirmed":',
    headers: { 'content-type': 'application/json' },
  });
}

export const accessibleSchedule = {
  pharmacist_id: 'user_1',
  case_: {
    primary_pharmacist_id: 'user_1',
    backup_pharmacist_id: null,
  },
};

export const VISIT_RECORD_VERSION = 2;
export const VISIT_RECORD_UPDATED_AT = new Date('2026-04-01T00:00:00.000Z');
export const VISIT_RECORD_UPDATED_AT_ISO = VISIT_RECORD_UPDATED_AT.toISOString();

export const confirmableHandoff = {
  next_check_items: ['血圧確認'],
  ongoing_monitoring: ['残薬管理'],
  decision_rationale: '継続確認が必要',
  ai_extracted: true,
  ai_confidence: 0.86,
  confirmed_by: null,
  confirmed_at: null,
  extracted_at: '2026-04-01T00:00:00.000Z',
};

export function buildVisitRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 'vr_1',
    version: VISIT_RECORD_VERSION,
    updated_at: VISIT_RECORD_UPDATED_AT,
    schedule: accessibleSchedule,
    structured_soap: {
      handoff: confirmableHandoff,
    },
    ...overrides,
  };
}
