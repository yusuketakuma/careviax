import type { MemberRole } from '@prisma/client';

const CARE_REPORT_CLINICAL_CONFIRMATION_ROLES: ReadonlySet<MemberRole> = new Set([
  'owner',
  'admin',
  'pharmacist',
]);

export function canConfirmCareReportClinicalJudgement(role: MemberRole) {
  return CARE_REPORT_CLINICAL_CONFIRMATION_ROLES.has(role);
}
