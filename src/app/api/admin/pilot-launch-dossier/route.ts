import { withAuthContext } from '@/lib/auth/context';
import {
  getBackupDrillSummary,
  getIsmsReadinessSummary,
  getPmdaOnboardingSummary,
} from '@/lib/operations/external-readiness';
import { success } from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { getPilotLaunchDossier } from '@/server/services/pilot-launch-dossier';

export const GET = withAuthContext(
  async (_req, ctx) => {
    const dossier = await getPilotLaunchDossier({
      orgId: ctx.orgId,
      externalReadiness: {
        pmda: getPmdaOnboardingSummary(),
        backup: getBackupDrillSummary(),
        isms: getIsmsReadinessSummary(),
      },
    });
    return withSensitiveNoStore(success({ data: dossier }));
  },
  {
    permission: 'canAdmin',
    message: 'pilot launch dossier の閲覧権限がありません',
  },
);
