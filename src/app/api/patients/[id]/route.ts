import { withAuthContext, type AuthRouteContext } from '@/lib/auth/context';
import { hasPermission } from '@/lib/auth/permissions';
import { authenticatedPatientGET } from './patient-get-handler';

export const GET = withAuthContext(
  (req, ctx, routeContext: AuthRouteContext<{ id: string }>) =>
    authenticatedPatientGET(req, ctx, routeContext, {
      canManageBilling: hasPermission(ctx.role, 'canManageBilling'),
      canCreateExternalShare: hasPermission(ctx.role, 'canManagePatientSharing'),
      canCreateReplyRequest: hasPermission(ctx.role, 'canReport'),
      canCreateFollowupTask: hasPermission(ctx.role, 'canManageOperationalTasks'),
    }),
  { permission: 'canViewDashboard', message: '患者情報の閲覧権限がありません' },
);

export { PATCH } from './patient-patch-handler';
