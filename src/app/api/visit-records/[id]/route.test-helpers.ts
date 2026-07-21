import { NextRequest } from 'next/server';

const VISIT_RECORD_DETAIL_URL = 'http://localhost/api/visit-records/visit_1';

export function createVisitRecordDetailRequest(body?: unknown) {
  if (body === undefined) {
    return new NextRequest(VISIT_RECORD_DETAIL_URL, {
      headers: { 'x-org-id': 'org_1' },
    });
  }

  return new NextRequest(VISIT_RECORD_DETAIL_URL, {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: {
      'content-type': 'application/json',
      'x-org-id': 'org_1',
    },
  });
}

export function createMalformedVisitRecordPatchRequest() {
  return new NextRequest(VISIT_RECORD_DETAIL_URL, {
    method: 'PATCH',
    body: '{"version":',
    headers: {
      'content-type': 'application/json',
      'x-org-id': 'org_1',
    },
  });
}

export const completedVisitStructuredSoap = {
  subjective: { symptom_checks: [], free_text: '服薬状況を確認' },
  objective: {
    medication_status: 'full_compliance',
    adherence_score: 4,
    side_effect_checks: ['none'],
    lab_values: {
      egfr: 42,
      scr: 1.2,
    },
  },
  assessment: {
    problem_checks: ['interaction_risk'],
  },
  plan: {
    intervention_checks: ['physician_report'],
    free_text: '医師へ報告し次回も確認',
  },
  home_visit_2026: {
    medication_review_completed: true,
    residual_medication_checked: true,
    adverse_event_checked: true,
    polypharmacy_reviewed: true,
    after_hours_contact_confirmed: true,
  },
};
