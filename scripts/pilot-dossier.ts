import process from 'node:process';
import {
  getBackupDrillSummary,
  getIsmsReadinessSummary,
  getPmdaOnboardingSummary,
} from '@/lib/operations/external-readiness';
import {
  formatPilotLaunchDossierMarkdown,
  getPilotLaunchDossier,
} from '@/server/services/pilot-launch-dossier';
import { parseOrgReportArgs } from './_shared/report-cli';

async function main() {
  const args = parseOrgReportArgs(process.argv.slice(2));
  const dossier = await getPilotLaunchDossier({
    orgId: args.orgId,
    externalReadiness: {
      pmda: getPmdaOnboardingSummary(),
      backup: getBackupDrillSummary(),
      isms: getIsmsReadinessSummary(),
    },
  });

  if (args.format === 'json') {
    console.log(JSON.stringify(dossier, null, 2));
    return;
  }

  console.log(formatPilotLaunchDossierMarkdown(dossier));
}

void main();
