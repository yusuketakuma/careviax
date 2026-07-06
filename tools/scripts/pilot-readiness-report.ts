import process from 'node:process';
import { getPilotReadinessSnapshot } from '@/server/services/pilot-readiness';
import { parseOrgReportArgs } from './_shared/report-cli';

async function main() {
  const args = parseOrgReportArgs(process.argv.slice(2));
  const snapshot = await getPilotReadinessSnapshot(args.orgId);

  if (args.format === 'json') {
    console.log(JSON.stringify(snapshot, null, 2));
    return;
  }

  console.log(`# Pilot Readiness Report

- org_id: ${args.orgId}
- generated_at: ${snapshot.generated_at}
- active_cases: ${snapshot.case_summary.active_case_count}
- facility_linked_cases: ${snapshot.case_summary.facility_linked_case_count}
- facility_count: ${snapshot.case_summary.facility_count}
- set_pilot_cases: ${snapshot.case_summary.set_pilot_case_count}
- uat_blockers: ${snapshot.uat_summary.blocker_count}
- phase2_entry: ${snapshot.decisions.phase2_entry}
- pilot_phi_entry: ${snapshot.decisions.pilot_phi_entry}
- aws_pilot_mode: ${snapshot.aws_pilot_summary.mode}
- aws_pilot_status: ${snapshot.aws_pilot_summary.overall_status}
- aws_phi_input_status: ${snapshot.aws_pilot_summary.phi_input_status}
- aws_pilot_blocked_checks: ${snapshot.aws_pilot_summary.blocked_count}
- aws_pilot_warning_checks: ${snapshot.aws_pilot_summary.warning_count}

## AWS Pilot Checks
${snapshot.aws_pilot_summary.checks
  .map(
    (item) =>
      `- [${item.status}] ${item.id}: ${item.message}${item.remediation ? ` (${item.remediation})` : ''}`,
  )
  .join('\n')}

## Recommendations
${snapshot.recommendations.map((item) => `- ${item}`).join('\n')}
`);
}

void main();
