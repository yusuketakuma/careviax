import { describe, expect, it } from 'vitest';
import { readCommunicationRequestsState } from './requests-query-state';

describe('requests-query-state', () => {
  it('reads supported communication request params', () => {
    expect(
      readCommunicationRequestsState({
        status: 'sent',
        patient_id: 'patient_1',
        related_entity_type: 'care_report',
        related_entity_id: 'report_1',
        context: 'dashboard_home',
      }),
    ).toEqual({
      initialStatus: 'sent',
      initialPatientId: 'patient_1',
      initialRelatedEntityType: 'care_report',
      initialRelatedEntityId: 'report_1',
      initialContext: 'dashboard_home',
    });
  });
});
