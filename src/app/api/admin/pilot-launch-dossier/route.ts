import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import {
  getBackupDrillSummary,
  getIsmsReadinessSummary,
  getPmdaOnboardingSummary,
} from '@/lib/operations/external-readiness';
import { success } from '@/lib/api/response';
import { getPilotLaunchDossier } from '@/server/services/pilot-launch-dossier';

export const GET = withAuth(
  async (req: AuthenticatedRequest) => {
    const dossier = await getPilotLaunchDossier({
      orgId: req.orgId,
      externalReadiness: {
        pmda: getPmdaOnboardingSummary(),
        backup: getBackupDrillSummary(),
        isms: getIsmsReadinessSummary(),
      },
    });
    return success({ data: dossier });
  },
  {
    permission: 'canAdmin',
    message: 'pilot launch dossier の閲覧権限がありません',
  }
);
