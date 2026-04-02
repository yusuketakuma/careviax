import process from 'node:process';
import { getPilotOrgAuditSnapshot } from '@/server/services/pilot-org-audit';
import { parseOrgReportArgs } from './_shared/report-cli';

async function main() {
  const args = parseOrgReportArgs(process.argv.slice(2));
  const snapshot = await getPilotOrgAuditSnapshot(args.orgId);

  if (args.format === 'json') {
    console.log(JSON.stringify(snapshot, null, 2));
    return;
  }

  console.log(`# Pilot Org Audit

- org_id: ${args.orgId}
- generated_at: ${snapshot.generated_at}
- sites: ${snapshot.org_structure.site_count}
- active_members: ${snapshot.org_structure.active_member_count}
- active_cases: ${snapshot.pilot_targets.active_case_count}
- facility_linked_cases: ${snapshot.pilot_targets.facility_linked_case_count}
- set_pilot_cases: ${snapshot.pilot_targets.set_pilot_case_count}
- service_area_covered: ${snapshot.coverage.service_area_covered_count}
- radius_16km_covered: ${snapshot.coverage.radius_16km_covered_count}
- uncovered: ${snapshot.coverage.uncovered_count}
- review_required: ${snapshot.coverage.review_required_count}
- flagged_patients: ${snapshot.coverage.flagged_patient_count}${snapshot.coverage.flagged_patients_truncated ? ' (preview truncated)' : ''}

## Role Counts
${Object.entries(snapshot.org_structure.role_counts)
  .map(([role, count]) => `- ${role}: ${count}`)
  .join('\n')}

## Site Breakdown
${snapshot.org_structure.site_breakdown
  .map(
    (site) =>
      `- ${site.site_name}: active_members=${site.active_member_count}, service_areas=${site.service_area_count}, has_geo=${site.has_geo ? 'yes' : 'no'}`
  )
  .join('\n')}

## Recommendations
${snapshot.recommendations.map((item) => `- ${item}`).join('\n')}

## Flagged Patients
${snapshot.coverage.flagged_patients.length === 0
    ? '- なし'
    : snapshot.coverage.flagged_patients
        .map(
          (patient) =>
            `- ${patient.patient_name}: ${patient.reason}${patient.nearest_site_name ? ` / nearest=${patient.nearest_site_name}` : ''}${patient.nearest_site_distance_km != null ? ` / ${patient.nearest_site_distance_km}km` : ''}`
        )
        .join('\n')}
`);
}

void main();
