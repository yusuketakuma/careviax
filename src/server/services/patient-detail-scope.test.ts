import { describe, expect, it } from 'vitest';
import {
  buildAssignedCareCaseWhere,
  buildCareReportCaseScope,
  buildNullableCaseScope,
  buildPatientDetailWhere,
  buildVisitRecordCaseScope,
} from './patient-detail-scope';

describe('patient-detail-scope', () => {
  it('applies case assignment visibility to patient detail lookups for non-admin roles', () => {
    expect(
      buildPatientDetailWhere({
        orgId: 'org_1',
        patientId: 'patient_1',
        role: 'pharmacist',
        userId: 'user_1',
      }),
    ).toEqual({
      id: 'patient_1',
      org_id: 'org_1',
    });
  });

  it('does not add assignment filters for owner/admin roles', () => {
    expect(
      buildPatientDetailWhere({
        orgId: 'org_1',
        patientId: 'patient_1',
        role: 'admin',
        userId: 'admin_1',
      }),
    ).toEqual({
      id: 'patient_1',
      org_id: 'org_1',
    });
    expect(buildAssignedCareCaseWhere({ role: 'owner', userId: 'owner_1' })).toBeUndefined();
  });

  it('passes base care-case filters through unchanged for org-wide roles', () => {
    expect(
      buildAssignedCareCaseWhere(
        { role: 'pharmacist', userId: 'user_1' },
        { status: { in: ['active', 'assessment'] } },
      ),
    ).toEqual({
      status: { in: ['active', 'assessment'] },
    });
  });

  it('builds shared case scopes for downstream patient-detail queries', () => {
    expect(buildVisitRecordCaseScope(['case_1', 'case_2'])).toEqual({
      schedule: {
        case_id: { in: ['case_1', 'case_2'] },
      },
    });
    expect(buildCareReportCaseScope(['case_1'])).toEqual({
      OR: [{ case_id: { in: ['case_1'] } }, { case_id: null }],
    });
    expect(buildNullableCaseScope(['case_1'])).toEqual({
      OR: [{ case_id: null }, { case_id: { in: ['case_1'] } }],
    });
  });
});
