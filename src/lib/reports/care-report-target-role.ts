export function inferCareReportTargetRole(reportType: string) {
  switch (reportType) {
    case 'physician_report':
      return 'physician';
    case 'care_manager_report':
      return 'care_manager';
    case 'facility_handoff':
      return 'facility_staff';
    case 'nurse_share':
      return 'nurse';
    case 'family_share':
      return 'family';
    default:
      return 'other';
  }
}
