import type { AuthContext } from '@/lib/auth/context';
import { hasPermission } from '@/lib/auth/permissions';
import type { CareReportActionPermissions } from '@/types/care-report-permissions';

export function canOutputCareReport(role: AuthContext['role']) {
  return hasPermission(role, 'canSendCareReport');
}

export function buildCareReportActionPermissions(
  role: AuthContext['role'],
): CareReportActionPermissions {
  const canOutput = canOutputCareReport(role);
  return {
    can_edit: hasPermission(role, 'canAuthorReport'),
    can_send: canOutput,
    can_create_external_share: canOutput,
    can_create_followup_task: hasPermission(role, 'canVisit'),
    can_view_patient: hasPermission(role, 'canVisit'),
    can_view_related_requests: canOutput,
  };
}
