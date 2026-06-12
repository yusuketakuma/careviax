import { describe, expect, it } from 'vitest';
import { readReportsState } from './reports-query-state';

describe('reports-query-state', () => {
  it('reads supported reports params', () => {
    expect(
      readReportsState({
        focus: 'delivery',
        delivery_status: 'response_waiting',
        context: 'dashboard_home',
        patient_id: 'patient_1',
        visit_record_id: 'visit_1',
      }),
    ).toEqual({
      initialFocus: 'delivery',
      initialDeliveryStatus: 'response_waiting',
      initialContext: 'dashboard_home',
      initialPatientId: 'patient_1',
      initialVisitRecordId: 'visit_1',
    });
  });
});
