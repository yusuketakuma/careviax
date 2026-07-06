import { describe, expect, it } from 'vitest';
import { buildPilotLaunchDossier, formatPilotLaunchDossierMarkdown } from './pilot-launch-dossier';

describe('pilot-launch-dossier', () => {
  it('adds external blocker recommendations when PMDA, backup, and ISMS are still pending', () => {
    const dossier = buildPilotLaunchDossier({
      orgId: 'org_1',
      now: new Date('2026-03-31T00:00:00.000Z'),
      readiness: {
        generated_at: '2026-03-31T00:00:00.000Z',
        case_summary: {
          active_case_count: 2,
          facility_linked_case_count: 0,
          non_facility_case_count: 2,
          facility_count: 0,
          set_pilot_case_count: 0,
          set_pilot_without_facility_count: 0,
        },
        uat_summary: {
          total_feedback: 1,
          critical_count: 1,
          high_count: 0,
          medium_count: 0,
          low_count: 0,
          blocker_count: 1,
          recent_feedback: [],
        },
        decisions: {
          facility_batching: 'phase2_candidate',
          medication_set_workflow: 'phase2_candidate',
          phase2_entry: 'blocked',
          pilot_phi_entry: 'blocked',
        },
        aws_pilot_summary: {
          mode: 'local_static_no_live_aws',
          overall_status: 'blocked',
          phi_input_status: 'blocked',
          required_for_phi_count: 9,
          ready_count: 6,
          warning_count: 1,
          blocked_count: 3,
          checks: [],
        },
        recommendations: [
          '施設患者が未確認です。FacilityVisitBatch と自動ルート最適化は Phase 2 移行候補として扱ってください。',
        ],
      },
      orgAudit: {
        generated_at: '2026-03-31T00:00:00.000Z',
        org_structure: {
          site_count: 1,
          active_member_count: 2,
          role_counts: { owner: 1, pharmacist: 1 },
          site_breakdown: [],
        },
        pilot_targets: {
          active_case_count: 2,
          facility_linked_case_count: 0,
          set_pilot_case_count: 0,
        },
        coverage: {
          total_primary_residences: 2,
          flagged_patient_count: 1,
          flagged_patients_truncated: false,
          service_area_covered_count: 1,
          radius_16km_covered_count: 0,
          uncovered_count: 1,
          review_required_count: 0,
          flagged_patients: [
            {
              patient_id: 'patient_1',
              patient_name: '佐藤 花子',
              address: '東京都八王子市1-1-1',
              reason: '既存拠点から 16km 圏外',
              nearest_site_name: '本店',
              nearest_site_distance_km: 22.4,
            },
          ],
        },
        recommendations: [
          '1 件の患者住所が既存拠点の 16km 圏外です。対象店舗か訪問体制を見直してください。',
        ],
      },
      uatSummary: {
        generated_at: '2026-03-31T00:00:00.000Z',
        total_feedback: 1,
        priorities: {
          critical: 1,
          high: 0,
          medium: 0,
          low: 0,
        },
        blocker_count: 1,
        action_items: [
          {
            id: 'feedback_1',
            priority: 'critical',
            status: 'open',
            feedback: '保存に失敗する',
            checklist_progress: '3/8',
            source: 'pilot_pharmacy',
            created_at: '2026-03-31T00:00:00.000Z',
          },
        ],
        checklist_coverage: [],
        recommendations: [
          'critical/high の blocker が 1 件あります。Phase 2 開始前に action_items の解消を優先してください。',
        ],
      },
      externalReadiness: {
        pmda: {
          registration: {
            medinavi_registered: false,
            my_drug_collection_registered: false,
          },
          distribution_urls: {
            full_configured: false,
            delta_configured: false,
          },
          docs: [],
          ready_for_import_test: false,
          next_steps: [],
        },
        backup: {
          files: [],
          env: [],
          ready_for_live_drill: false,
          recorded_runs: [],
          live_drill_recorded: false,
          live_run_count: 0,
          last_live_run_date: null,
          next_steps: [],
        },
        isms: {
          docs: [],
          comparison_table_started: false,
          decision_memo_started: false,
          ready_for_quote_request: true,
          next_steps: [],
        },
      },
    });

    expect(dossier.recommendations).toContain(
      'PMDA メディナビ登録または配布 URL 設定が未完了です。PMDA importer の本番疎通前提を満たしてください。',
    );
    expect(dossier.recommendations).toContain(
      'live backup drill の前提が不足しています。AWS 権限と必須環境変数を揃えてから実地試験に進んでください。',
    );
    expect(dossier.recommendations).toContain(
      'ISMS 審査機関の見積比較が未着手です。vendor comparison template を埋めて予算判断を始めてください。',
    );
  });

  it('keeps live drill as a blocker when only tabletop runs are recorded', () => {
    const dossier = buildPilotLaunchDossier({
      orgId: 'org_1',
      readiness: {
        generated_at: '2026-03-31T00:00:00.000Z',
        case_summary: {
          active_case_count: 1,
          facility_linked_case_count: 1,
          non_facility_case_count: 0,
          facility_count: 1,
          set_pilot_case_count: 1,
          set_pilot_without_facility_count: 0,
        },
        uat_summary: {
          total_feedback: 0,
          critical_count: 0,
          high_count: 0,
          medium_count: 0,
          low_count: 0,
          blocker_count: 0,
          recent_feedback: [],
        },
        decisions: {
          facility_batching: 'ready',
          medication_set_workflow: 'ready',
          phase2_entry: 'ready',
          pilot_phi_entry: 'local_ready_requires_live_confirmation',
        },
        aws_pilot_summary: {
          mode: 'local_static_no_live_aws',
          overall_status: 'ready',
          phi_input_status: 'local_ready_requires_live_confirmation',
          required_for_phi_count: 9,
          ready_count: 9,
          warning_count: 1,
          blocked_count: 0,
          checks: [],
        },
        recommendations: [],
      },
      orgAudit: {
        generated_at: '2026-03-31T00:00:00.000Z',
        org_structure: {
          site_count: 1,
          active_member_count: 1,
          role_counts: { owner: 1 },
          site_breakdown: [],
        },
        pilot_targets: {
          active_case_count: 1,
          facility_linked_case_count: 1,
          set_pilot_case_count: 1,
        },
        coverage: {
          total_primary_residences: 1,
          flagged_patient_count: 0,
          flagged_patients_truncated: false,
          service_area_covered_count: 1,
          radius_16km_covered_count: 1,
          uncovered_count: 0,
          review_required_count: 0,
          flagged_patients: [],
        },
        recommendations: [],
      },
      uatSummary: {
        generated_at: '2026-03-31T00:00:00.000Z',
        total_feedback: 0,
        priorities: {
          critical: 0,
          high: 0,
          medium: 0,
          low: 0,
        },
        blocker_count: 0,
        action_items: [],
        checklist_coverage: [],
        recommendations: [],
      },
      externalReadiness: {
        pmda: {
          registration: {
            medinavi_registered: true,
            my_drug_collection_registered: true,
          },
          distribution_urls: {
            full_configured: true,
            delta_configured: true,
          },
          docs: [],
          ready_for_import_test: true,
          next_steps: [],
        },
        backup: {
          files: [],
          env: [],
          ready_for_live_drill: true,
          recorded_runs: [
            {
              date: '2026-03-31',
              operator: 'Codex',
              result: '机上訓練前提確認完了',
              duration: '5分',
              notes: '[mode:tabletop] runbook 確認',
              mode: 'tabletop',
            },
          ],
          live_drill_recorded: false,
          live_run_count: 0,
          last_live_run_date: null,
          next_steps: [],
        },
        isms: {
          docs: [],
          comparison_table_started: true,
          decision_memo_started: true,
          ready_for_quote_request: true,
          next_steps: [],
        },
      },
    });

    expect(dossier.recommendations).toContain(
      'バックアップ復旧試験は机上訓練のみです。Phase 2 判定前に live drill を 1 回記録してください。',
    );
  });

  it('formats a markdown dossier with action items and flagged patients', () => {
    const markdown = formatPilotLaunchDossierMarkdown({
      generated_at: '2026-03-31T00:00:00.000Z',
      org_id: 'org_1',
      readiness: {
        generated_at: '2026-03-31T00:00:00.000Z',
        case_summary: {
          active_case_count: 1,
          facility_linked_case_count: 1,
          non_facility_case_count: 0,
          facility_count: 1,
          set_pilot_case_count: 1,
          set_pilot_without_facility_count: 0,
        },
        uat_summary: {
          total_feedback: 0,
          critical_count: 0,
          high_count: 0,
          medium_count: 0,
          low_count: 0,
          blocker_count: 0,
          recent_feedback: [],
        },
        decisions: {
          facility_batching: 'ready',
          medication_set_workflow: 'ready',
          phase2_entry: 'ready',
          pilot_phi_entry: 'local_ready_requires_live_confirmation',
        },
        aws_pilot_summary: {
          mode: 'local_static_no_live_aws',
          overall_status: 'ready',
          phi_input_status: 'local_ready_requires_live_confirmation',
          required_for_phi_count: 9,
          ready_count: 9,
          warning_count: 1,
          blocked_count: 0,
          checks: [],
        },
        recommendations: [],
      },
      org_audit: {
        generated_at: '2026-03-31T00:00:00.000Z',
        org_structure: {
          site_count: 1,
          active_member_count: 1,
          role_counts: { owner: 1 },
          site_breakdown: [],
        },
        pilot_targets: {
          active_case_count: 1,
          facility_linked_case_count: 1,
          set_pilot_case_count: 1,
        },
        coverage: {
          total_primary_residences: 1,
          flagged_patient_count: 1,
          flagged_patients_truncated: false,
          service_area_covered_count: 0,
          radius_16km_covered_count: 0,
          uncovered_count: 1,
          review_required_count: 0,
          flagged_patients: [
            {
              patient_id: 'patient_1',
              patient_name: '田中 一郎',
              address: '東京都八王子市1-1-1',
              reason: '既存拠点から 16km 圏外',
              nearest_site_name: '本店',
              nearest_site_distance_km: 20.5,
            },
          ],
        },
        recommendations: [],
      },
      uat_summary: {
        generated_at: '2026-03-31T00:00:00.000Z',
        total_feedback: 1,
        priorities: {
          critical: 0,
          high: 0,
          medium: 1,
          low: 0,
        },
        blocker_count: 0,
        action_items: [
          {
            id: 'feedback_1',
            priority: 'medium',
            status: 'triaged',
            feedback: '印刷の余白を調整したい',
            checklist_progress: '6/8',
            source: 'pilot_pharmacy',
            created_at: '2026-03-31T00:00:00.000Z',
          },
        ],
        checklist_coverage: [],
        recommendations: [],
      },
      external_readiness: {
        pmda: {
          registration: {
            medinavi_registered: true,
            my_drug_collection_registered: true,
          },
          distribution_urls: {
            full_configured: true,
            delta_configured: true,
          },
          docs: [],
          ready_for_import_test: true,
          next_steps: [],
        },
        backup: {
          files: [],
          env: [],
          ready_for_live_drill: true,
          recorded_runs: [
            {
              date: '2026-03-31',
              operator: '運用担当',
              result: '机上訓練完了',
              duration: '30分',
              notes: '確認済み',
              mode: 'tabletop',
            },
          ],
          live_drill_recorded: false,
          live_run_count: 0,
          last_live_run_date: null,
          next_steps: [],
        },
        isms: {
          docs: [],
          comparison_table_started: true,
          decision_memo_started: true,
          ready_for_quote_request: true,
          next_steps: [],
        },
      },
      recommendations: ['対象薬局の 16km 圏外患者を確認してください。'],
    });

    expect(markdown).toContain('# Pilot Launch Dossier');
    expect(markdown).toContain('- phase2_entry: ready');
    expect(markdown).toContain('- [medium/triaged] 印刷の余白を調整したい');
    expect(markdown).toContain('- 田中 一郎: 既存拠点から 16km 圏外 / nearest=本店 / 20.5km');
  });
});
