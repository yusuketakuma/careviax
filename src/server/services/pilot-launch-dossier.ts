import type { BackupDrillSummary, IsmsReadinessSummary, PmdaOnboardingSummary } from '@/lib/operations/external-readiness';
import type { PilotOrgAuditSnapshot } from './pilot-org-audit';
import type { PilotReadinessSnapshot } from './pilot-readiness';
import type { UatFeedbackSummary } from './uat-feedback-summary';

export type PilotLaunchDossier = {
  generated_at: string;
  org_id: string;
  readiness: PilotReadinessSnapshot;
  org_audit: PilotOrgAuditSnapshot;
  uat_summary: UatFeedbackSummary;
  external_readiness: {
    pmda: PmdaOnboardingSummary;
    backup: BackupDrillSummary;
    isms: IsmsReadinessSummary;
  };
  recommendations: string[];
};

function dedupe(items: string[]) {
  return Array.from(new Set(items.map((item) => item.trim()).filter(Boolean)));
}

export function buildPilotLaunchDossier(args: {
  orgId: string;
  readiness: PilotReadinessSnapshot;
  orgAudit: PilotOrgAuditSnapshot;
  uatSummary: UatFeedbackSummary;
  externalReadiness: {
    pmda: PmdaOnboardingSummary;
    backup: BackupDrillSummary;
    isms: IsmsReadinessSummary;
  };
  now?: Date;
}): PilotLaunchDossier {
  const now = args.now ?? new Date();
  const recommendations = [
    ...args.readiness.recommendations,
    ...args.orgAudit.recommendations,
    ...args.uatSummary.recommendations,
  ];

  if (!args.externalReadiness.pmda.ready_for_import_test) {
    recommendations.push('PMDA メディナビ登録または配布 URL 設定が未完了です。PMDA importer の本番疎通前提を満たしてください。');
  }
  if (!args.externalReadiness.backup.ready_for_live_drill) {
    recommendations.push('live backup drill の前提が不足しています。AWS 権限と必須環境変数を揃えてから実地試験に進んでください。');
  }
  if (args.externalReadiness.backup.recorded_runs.length === 0) {
    recommendations.push('バックアップ復旧試験の記録がありません。最低 1 回は実施記録を残してください。');
  } else if (!args.externalReadiness.backup.live_drill_recorded) {
    recommendations.push('バックアップ復旧試験は机上訓練のみです。Phase 2 判定前に live drill を 1 回記録してください。');
  }
  if (!args.externalReadiness.isms.comparison_table_started) {
    recommendations.push('ISMS 審査機関の見積比較が未着手です。vendor comparison template を埋めて予算判断を始めてください。');
  }
  if (!args.externalReadiness.isms.decision_memo_started) {
    recommendations.push('ISMS のスコープ・予算・キックオフ候補日が未記録です。意思決定メモを更新してください。');
  }

  return {
    generated_at: now.toISOString(),
    org_id: args.orgId,
    readiness: args.readiness,
    org_audit: args.orgAudit,
    uat_summary: args.uatSummary,
    external_readiness: args.externalReadiness,
    recommendations: dedupe(recommendations),
  };
}

export function formatPilotLaunchDossierMarkdown(dossier: PilotLaunchDossier) {
  const flaggedPatients = dossier.org_audit.coverage.flagged_patients.length
    ? dossier.org_audit.coverage.flagged_patients
        .map(
          (patient) =>
            `- ${patient.patient_name}: ${patient.reason}${patient.nearest_site_name ? ` / nearest=${patient.nearest_site_name}` : ''}${patient.nearest_site_distance_km != null ? ` / ${patient.nearest_site_distance_km}km` : ''}`
        )
        .join('\n')
    : '- なし';

  return `# Pilot Launch Dossier

- org_id: ${dossier.org_id}
- generated_at: ${dossier.generated_at}
- phase2_entry: ${dossier.readiness.decisions.phase2_entry}
- facility_batching: ${dossier.readiness.decisions.facility_batching}
- medication_set_workflow: ${dossier.readiness.decisions.medication_set_workflow}

## Target Pharmacy
- sites: ${dossier.org_audit.org_structure.site_count}
- active_members: ${dossier.org_audit.org_structure.active_member_count}
- active_cases: ${dossier.org_audit.pilot_targets.active_case_count}
- facility_linked_cases: ${dossier.org_audit.pilot_targets.facility_linked_case_count}
- set_pilot_cases: ${dossier.org_audit.pilot_targets.set_pilot_case_count}
- service_area_covered: ${dossier.org_audit.coverage.service_area_covered_count}
- radius_16km_covered: ${dossier.org_audit.coverage.radius_16km_covered_count}
- uncovered: ${dossier.org_audit.coverage.uncovered_count}
- review_required: ${dossier.org_audit.coverage.review_required_count}
- flagged_patients: ${dossier.org_audit.coverage.flagged_patient_count}${dossier.org_audit.coverage.flagged_patients_truncated ? ' (preview truncated)' : ''}

## UAT
- total_feedback: ${dossier.uat_summary.total_feedback}
- blocker_count: ${dossier.uat_summary.blocker_count}
- priorities: critical ${dossier.uat_summary.priorities.critical} / high ${dossier.uat_summary.priorities.high} / medium ${dossier.uat_summary.priorities.medium} / low ${dossier.uat_summary.priorities.low}

## External Readiness
- PMDA ready_for_import_test: ${dossier.external_readiness.pmda.ready_for_import_test ? 'yes' : 'no'}
- backup ready_for_live_drill: ${dossier.external_readiness.backup.ready_for_live_drill ? 'yes' : 'no'}
- backup recorded_runs: ${dossier.external_readiness.backup.recorded_runs.length}
- backup live_drill_recorded: ${dossier.external_readiness.backup.live_drill_recorded ? 'yes' : 'no'}
- ISMS comparison_started: ${dossier.external_readiness.isms.comparison_table_started ? 'yes' : 'no'}
- ISMS decision_memo_started: ${dossier.external_readiness.isms.decision_memo_started ? 'yes' : 'no'}

## Action Items
${dossier.uat_summary.action_items.length > 0
    ? dossier.uat_summary.action_items
        .map((item) => `- [${item.priority}/${item.status}] ${item.feedback}`)
        .join('\n')
    : '- 重大な blocker はありません'}

## Flagged Patients
${flaggedPatients}

## Recommendations
${dossier.recommendations.map((item) => `- ${item}`).join('\n')}
`;
}

export async function getPilotLaunchDossier(args: {
  orgId: string;
  externalReadiness: {
    pmda: PmdaOnboardingSummary;
    backup: BackupDrillSummary;
    isms: IsmsReadinessSummary;
  };
}) {
  const [{ getPilotReadinessSnapshot }, { getPilotOrgAuditSnapshot }, { getUatFeedbackSummary }] =
    await Promise.all([
      import('./pilot-readiness'),
      import('./pilot-org-audit'),
      import('./uat-feedback-summary'),
    ]);

  const [readiness, orgAudit, uatSummary] = await Promise.all([
    getPilotReadinessSnapshot(args.orgId),
    getPilotOrgAuditSnapshot(args.orgId),
    getUatFeedbackSummary(args.orgId),
  ]);

  return buildPilotLaunchDossier({
    orgId: args.orgId,
    readiness,
    orgAudit,
    uatSummary,
    externalReadiness: args.externalReadiness,
  });
}
