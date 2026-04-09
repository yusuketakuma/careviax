import { describe, expect, it } from 'vitest';
import {
  buildScheduleProposalHref,
  readScheduleProposalDashboardState,
  readScheduleProposalOptimizerState,
  readScheduleProposalWorkspace,
} from './proposal-query-state';

describe('proposal-query-state', () => {
  it('reads dashboard state from search params', () => {
    expect(
      readScheduleProposalDashboardState({
        status: 'patient_contact_pending',
        case_id: 'case_1',
        patient_id: 'patient_1',
        date_from: '2026-04-09',
        date_to: '2026-04-12',
        preset: 'today',
        detail: 'proposal_1',
        travel_mode: 'BICYCLE',
      })
    ).toEqual(
      expect.objectContaining({
        initialStatus: 'patient_contact_pending',
        initialCaseId: 'case_1',
        initialPatientId: 'patient_1',
        initialDateFrom: '2026-04-09',
        initialDateTo: '2026-04-12',
        initialPreset: 'today',
        initialDetailId: 'proposal_1',
        initialTravelMode: 'BICYCLE',
      })
    );
  });

  it('reads optimizer state and workspace from search params', () => {
    expect(readScheduleProposalWorkspace({ workspace: 'optimizer' })).toBe('optimizer');
    expect(
      readScheduleProposalOptimizerState({
        week: '2026-04-07',
        optimizer_case_id: 'case_2',
        optimizer_visit_type: 'emergency',
        optimizer_priority: 'urgent',
        optimizer_travel_mode: 'WALK',
        optimizer_time_from: '10:00',
        optimizer_time_to: '15:00',
        optimizer_pharmacist_id: 'pharmacist_1',
        optimizer_date: '2026-04-09',
      })
    ).toEqual(
      expect.objectContaining({
        initialDate: '2026-04-07',
        initialCaseId: 'case_2',
        initialVisitType: 'emergency',
        initialPriority: 'urgent',
        initialTravelMode: 'WALK',
        initialPreferredTimeFrom: '10:00',
        initialPreferredTimeTo: '15:00',
        initialRoutePharmacistId: 'pharmacist_1',
        initialRouteDate: '2026-04-09',
      })
    );
  });

  it('builds hrefs while preserving existing query params', () => {
    const href = buildScheduleProposalHref({
      params: {
        workspace: 'dashboard',
        case_id: 'case_1',
        detail: 'proposal_1',
      },
      patch: {
        workspace: 'optimizer',
        detail: null,
        optimizer_case_id: 'case_9',
      },
    });

    expect(href).toBe('/schedules/proposals?workspace=optimizer&case_id=case_1&optimizer_case_id=case_9');
  });
});
