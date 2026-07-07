import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildAwsPilotReadinessSummary,
  buildPilotReadinessSnapshot,
  type AwsPilotReadinessSummary,
} from './pilot-readiness';

const readyAwsPilotReadiness: AwsPilotReadinessSummary = {
  mode: 'local_static_no_live_aws',
  overall_status: 'ready',
  phi_input_status: 'local_ready_requires_live_confirmation',
  required_for_phi_count: 9,
  ready_count: 9,
  warning_count: 1,
  blocked_count: 0,
  checks: [
    {
      id: 'lightsail_ha_warning',
      label: 'Lightsail high availability warning',
      status: 'warning',
      required_for_phi: false,
      message: 'Lightsail pilot is not the HA production architecture.',
      evidence: ['docs/architecture/aws-phos-deployment-stages.md'],
    },
  ],
};

function createTempWorkspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ph-os-pilot-readiness-'));
}

function writeWorkspaceFile(root: string, relativePath: string, content = 'ready') {
  const absolutePath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, content);
}

function writeAwsPilotArtifacts(root: string) {
  [
    'docs/architecture/aws-phos-deployment-stages.md',
    'docs/operations/aws-cost-minimal-deployment.md',
    'docs/operations/rate-limit-production-runbook.md',
    'tools/scripts/aws-lightsail-pilot-plan.ts',
    'tools/scripts/aws-lightsail-runtime-env-validate.ts',
    'tools/infra/lightsail-pilot-template.yaml',
    'tools/infra/file-storage-bucket-policy.json',
    'tools/infra/prescription-object-lock.json',
    'tools/infra/s3-kms-key-policy.json',
    'tools/infra/cognito-advanced-security.json',
    'tools/infra/rate-limit-dynamodb.json',
    'tools/infra/cloudwatch-alarms.json',
    'tools/infra/eventbridge-schedules.json',
    'src/tools/rls-policy-contract.test.ts',
    'src/app/api/__tests__/api-conventions-static.test.ts',
    'docs/compliance/rds-configuration.md',
    'tools/infra/rds-aws-backup-template.yaml',
    'tools/scripts/aws-rds-backup-template-validate.ts',
    'tools/infra/vpc-security-groups.json',
  ].forEach((item) => writeWorkspaceFile(root, item));
  writeWorkspaceFile(
    root,
    'docs/compliance/backup-recovery-drill.md',
    `
| 実施日 | 担当 | 結果 | 所要時間 | メモ |
|---|---|---|---|---|
| 2026-07-06 | ops | pass | 2h | [mode:live; environment=recovery-drill; ticket=DRILL-20260706; approver=ops-lead; started_at=2026-07-06T01:00:00.000Z; completed_at=2026-07-06T03:00:00.000Z; rto_minutes=120; rpo_minutes=30; health=passed; redaction=passed; samples=patients:10,reports:5,audit:20; summary=本番相当RDS/S3/Cognito復旧] |
`,
  );
}

function readyAwsEnv(): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://example.invalid/phos',
    AWS_REGION: 'ap-northeast-1',
    NEXTAUTH_SECRET: 'secret',
    NEXT_PUBLIC_COGNITO_USER_POOL_ID: 'ap-northeast-1_pool',
    NEXT_PUBLIC_COGNITO_CLIENT_ID: 'client',
    COGNITO_CLIENT_SECRET: 'client-secret',
    S3_BUCKET_NAME: 'ph-os-files',
    SES_FROM_EMAIL: 'noreply@example.test',
    PHOS_CONTAINER_IMAGE: 'example.dkr.ecr.ap-northeast-1.amazonaws.com/phos:latest',
    PHOS_LIGHTSAIL_INSTANCE_BUNDLE_ID: 'small_2_0',
    PHOS_LIGHTSAIL_DB_BLUEPRINT_ID: 'postgres_16',
    RATE_LIMIT_STORE: 'dynamodb',
    RATE_LIMIT_DDB_TABLE_NAME: 'ph-os-rate-limit',
    RATE_LIMIT_DDB_REGION: 'ap-northeast-1',
  };
}

describe('buildPilotReadinessSnapshot', () => {
  it('flags phase2 candidates and blockers from current case/feedback mix', () => {
    const snapshot = buildPilotReadinessSnapshot({
      now: new Date('2026-03-31T00:00:00.000Z'),
      awsPilotReadiness: readyAwsPilotReadiness,
      cases: [
        {
          id: 'case_1',
          status: 'active',
          required_visit_support: { set_pilot_enabled: true },
          patient: {
            id: 'patient_1',
            name: '田中 一郎',
            residences: [{ facility_id: 'facility_1' }],
          },
        },
        {
          id: 'case_2',
          status: 'active',
          required_visit_support: null,
          patient: {
            id: 'patient_2',
            name: '山田 花子',
            residences: [{ facility_id: null }],
          },
        },
      ],
      feedback: [
        {
          id: 'feedback_1',
          priority: 'high',
          status: 'open',
          feedback: '戻る導線が分かりづらい',
          checklist_progress: '4/7',
          source: 'pilot_pharmacy',
          created_at: new Date('2026-03-30T12:00:00.000Z'),
        },
      ],
    });

    expect(snapshot.case_summary).toMatchObject({
      active_case_count: 2,
      facility_linked_case_count: 1,
      set_pilot_case_count: 1,
    });
    expect(snapshot.uat_summary.blocker_count).toBe(1);
    expect(snapshot.decisions.phase2_entry).toBe('blocked');
    expect(snapshot.decisions.pilot_phi_entry).toBe('local_ready_requires_live_confirmation');
    expect(snapshot.recommendations).toContain(
      'UAT に critical/high が 1 件あります。Phase 2 開始前に優先修正を完了してください。',
    );
  });

  it('recommends phase2 deferral when facility/set pilot data is absent', () => {
    const snapshot = buildPilotReadinessSnapshot({
      awsPilotReadiness: readyAwsPilotReadiness,
      cases: [
        {
          id: 'case_1',
          status: 'assessment',
          required_visit_support: null,
          patient: {
            id: 'patient_1',
            name: '佐藤 次郎',
            residences: [{ facility_id: null }],
          },
        },
        {
          id: 'case_2',
          status: 'active',
          required_visit_support: [{ set_pilot_enabled: true }],
          patient: {
            id: 'patient_2',
            name: '配列 設定',
            residences: [{ facility_id: null }],
          },
        },
      ],
      feedback: [],
    });

    expect(snapshot.case_summary.set_pilot_case_count).toBe(0);
    expect(snapshot.decisions).toMatchObject({
      facility_batching: 'phase2_candidate',
      medication_set_workflow: 'phase2_candidate',
      phase2_entry: 'ready',
    });
    expect(snapshot.recommendations.some((item) => item.includes('FacilityVisitBatch'))).toBe(true);
    expect(snapshot.recommendations.some((item) => item.includes('セット本格機能'))).toBe(true);
  });

  it('does not block phase2 when critical/high items are already resolved or deferred', () => {
    const snapshot = buildPilotReadinessSnapshot({
      awsPilotReadiness: readyAwsPilotReadiness,
      cases: [],
      feedback: [
        {
          id: 'feedback_1',
          priority: 'critical',
          status: 'resolved',
          feedback: '保存失敗',
          checklist_progress: '8/8',
          source: 'pilot_pharmacy',
          created_at: new Date('2026-03-31T12:00:00.000Z'),
        },
        {
          id: 'feedback_2',
          priority: 'high',
          status: 'deferred',
          feedback: '改善要望',
          checklist_progress: '8/8',
          source: 'pilot_pharmacy',
          created_at: new Date('2026-03-31T11:00:00.000Z'),
        },
      ],
    });

    expect(snapshot.uat_summary.blocker_count).toBe(0);
    expect(snapshot.decisions.phase2_entry).toBe('ready');
  });

  it('blocks pilot PHI entry when AWS pilot readiness is incomplete', () => {
    const snapshot = buildPilotReadinessSnapshot({
      now: new Date('2026-07-06T00:00:00.000Z'),
      awsPilotReadiness: {
        ...readyAwsPilotReadiness,
        overall_status: 'blocked',
        phi_input_status: 'blocked',
        blocked_count: 2,
        checks: [
          {
            id: 'rate_limit_dynamodb_runtime',
            label: 'DynamoDB rate-limit runtime',
            status: 'blocked',
            required_for_phi: true,
            message: 'Production rate limiting is not fully configured for DynamoDB.',
            evidence: [],
          },
        ],
      },
      cases: [],
      feedback: [],
    });

    expect(snapshot.decisions.pilot_phi_entry).toBe('blocked');
    expect(snapshot.recommendations).toContain(
      'AWS pilot readiness に 2 件の未完了チェックがあります。PHI投入前に blocked 項目を解消してください。',
    );
  });
});

describe('buildAwsPilotReadinessSummary', () => {
  it('passes local pilot gate when required artifacts, env, and live drill are present', () => {
    const cwd = createTempWorkspace();
    writeAwsPilotArtifacts(cwd);

    const summary = buildAwsPilotReadinessSummary({
      cwd,
      env: readyAwsEnv(),
    });

    expect(summary.overall_status).toBe('ready');
    expect(summary.mode).toBe('local_static_no_live_aws');
    expect(summary.phi_input_status).toBe('local_ready_requires_live_confirmation');
    expect(summary.blocked_count).toBe(0);
    expect(summary.warning_count).toBeGreaterThan(0);
    expect(summary.checks.find((item) => item.id === 'backup_live_drill')).toMatchObject({
      status: 'ready',
    });
  });

  it('fails closed without leaking secret values when runtime env is incomplete', () => {
    const cwd = createTempWorkspace();
    writeAwsPilotArtifacts(cwd);

    const summary = buildAwsPilotReadinessSummary({
      cwd,
      env: {
        NODE_ENV: 'test',
        DATABASE_URL: 'postgresql://secret-user:secret-pass@example.invalid/phos',
        NEXTAUTH_SECRET: 'super-secret',
        RATE_LIMIT_STORE: 'memory',
      },
    });

    const serialized = JSON.stringify(summary);
    expect(summary.overall_status).toBe('blocked');
    expect(summary.phi_input_status).toBe('blocked');
    expect(summary.blocked_count).toBeGreaterThan(0);
    expect(serialized).toContain('env:DATABASE_URL');
    expect(serialized).toContain('env:NEXTAUTH_SECRET');
    expect(serialized).not.toContain('secret-pass');
    expect(serialized).not.toContain('super-secret');
  });
});
