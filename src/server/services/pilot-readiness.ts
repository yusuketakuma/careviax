import fs from 'node:fs';
import path from 'node:path';
import { isUnresolvedUatBlocker } from '@/lib/uat-feedback';
import { readJsonObject } from '@/lib/db/json';
import {
  getBackupDrillSummary,
  type BackupDrillSummary,
} from '@/lib/operations/external-readiness';

type PilotReadinessCase = {
  id: string;
  status: string;
  required_visit_support: unknown;
  patient: {
    id: string;
    name: string;
    residences: Array<{
      facility_id: string | null;
    }>;
  };
};

type PilotReadinessFeedback = {
  id: string;
  priority: 'critical' | 'high' | 'medium' | 'low' | string;
  status: string;
  feedback: string;
  checklist_progress: string | null;
  source: string | null;
  created_at: Date;
};

export type PilotReadinessSnapshot = {
  generated_at: string;
  case_summary: {
    active_case_count: number;
    facility_linked_case_count: number;
    non_facility_case_count: number;
    facility_count: number;
    set_pilot_case_count: number;
    set_pilot_without_facility_count: number;
  };
  uat_summary: {
    total_feedback: number;
    critical_count: number;
    high_count: number;
    medium_count: number;
    low_count: number;
    blocker_count: number;
    recent_feedback: Array<{
      id: string;
      priority: string;
      feedback: string;
      checklist_progress: string | null;
      source: string | null;
      created_at: string;
    }>;
  };
  decisions: {
    facility_batching: 'ready' | 'phase2_candidate';
    medication_set_workflow: 'ready' | 'phase2_candidate';
    phase2_entry: 'ready' | 'blocked';
    pilot_phi_entry: 'blocked' | 'local_ready_requires_live_confirmation';
  };
  aws_pilot_summary: AwsPilotReadinessSummary;
  recommendations: string[];
};

export type AwsPilotReadinessCheckStatus = 'ready' | 'warning' | 'blocked';

export type AwsPilotReadinessCheck = {
  id: string;
  label: string;
  status: AwsPilotReadinessCheckStatus;
  required_for_phi: boolean;
  message: string;
  evidence: string[];
  remediation?: string;
};

export type AwsPilotReadinessSummary = {
  mode: 'local_static_no_live_aws';
  overall_status: 'ready' | 'blocked';
  phi_input_status: 'blocked' | 'local_ready_requires_live_confirmation';
  required_for_phi_count: number;
  ready_count: number;
  warning_count: number;
  blocked_count: number;
  checks: AwsPilotReadinessCheck[];
};

const AWS_PILOT_ARTIFACTS = {
  architecture: ['docs/architecture/aws-phos-deployment-stages.md'],
  lightsail: [
    'docs/operations/aws-cost-minimal-deployment.md',
    'tools/scripts/aws-lightsail-pilot-plan.ts',
    'tools/scripts/aws-lightsail-runtime-env-validate.ts',
    'tools/infra/lightsail-pilot-template.yaml',
  ],
  s3Phi: [
    'tools/infra/file-storage-bucket-policy.json',
    'tools/infra/prescription-object-lock.json',
    'tools/infra/s3-kms-key-policy.json',
  ],
  cognitoSes: ['tools/infra/cognito-advanced-security.json'],
  rateLimit: [
    'docs/operations/rate-limit-production-runbook.md',
    'tools/infra/rate-limit-dynamodb.json',
  ],
  monitoring: ['tools/infra/cloudwatch-alarms.json', 'tools/infra/eventbridge-schedules.json'],
  tenancyContracts: [
    'src/tools/rls-policy-contract.test.ts',
    'src/app/api/__tests__/api-conventions-static.test.ts',
  ],
} as const;

const LIGHTSAIL_RUNTIME_ENV_KEYS = [
  'DATABASE_URL',
  'AWS_REGION',
  'NEXT_PUBLIC_COGNITO_USER_POOL_ID',
  'NEXT_PUBLIC_COGNITO_CLIENT_ID',
  'COGNITO_CLIENT_SECRET',
  'S3_BUCKET_NAME',
  'SES_FROM_EMAIL',
  'PHOS_CONTAINER_IMAGE',
  'PHOS_LIGHTSAIL_INSTANCE_BUNDLE_ID',
  'PHOS_LIGHTSAIL_DB_BLUEPRINT_ID',
] as const;

function isPresent(value: string | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function hasAuthSecret(env: NodeJS.ProcessEnv): boolean {
  return isPresent(env.NEXTAUTH_SECRET) || isPresent(env.AUTH_SECRET);
}

function authSecretEvidence(env: NodeJS.ProcessEnv): string | null {
  if (isPresent(env.NEXTAUTH_SECRET)) return 'env:NEXTAUTH_SECRET';
  if (isPresent(env.AUTH_SECRET)) return 'env:AUTH_SECRET';
  return null;
}

function existingArtifacts(cwd: string, artifacts: readonly string[]) {
  return artifacts.filter((item) => fs.existsSync(path.join(cwd, item)));
}

function buildArtifactCheck(args: {
  cwd: string;
  id: string;
  label: string;
  artifacts: readonly string[];
  requiredForPhi?: boolean;
  remediation: string;
}): AwsPilotReadinessCheck {
  const evidence = existingArtifacts(args.cwd, args.artifacts);
  const allPresent = evidence.length === args.artifacts.length;
  return {
    id: args.id,
    label: args.label,
    required_for_phi: args.requiredForPhi ?? true,
    status: allPresent ? 'ready' : 'blocked',
    message: allPresent
      ? 'Required local readiness artifacts are present.'
      : `Missing ${args.artifacts.length - evidence.length} required readiness artifact(s).`,
    evidence,
    remediation: allPresent ? undefined : args.remediation,
  };
}

function buildEnvCheck(args: {
  env: NodeJS.ProcessEnv;
  id: string;
  label: string;
  keys: readonly string[];
  requiredForPhi?: boolean;
  remediation: string;
}): AwsPilotReadinessCheck {
  const configured = args.keys.filter((key) => isPresent(args.env[key]));
  const hasAllConfigured = configured.length === args.keys.length;
  return {
    id: args.id,
    label: args.label,
    required_for_phi: args.requiredForPhi ?? true,
    status: hasAllConfigured ? 'ready' : 'blocked',
    message: hasAllConfigured
      ? 'Required runtime environment keys are configured.'
      : `Missing ${args.keys.length - configured.length} required runtime environment key(s).`,
    evidence: configured.map((key) => `env:${key}`),
    remediation: hasAllConfigured ? undefined : args.remediation,
  };
}

export function buildAwsPilotReadinessSummary(args?: {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  backupSummary?: BackupDrillSummary;
}): AwsPilotReadinessSummary {
  const cwd = args?.cwd ?? process.cwd();
  const env = args?.env ?? process.env;
  const backupSummary = args?.backupSummary ?? getBackupDrillSummary({ cwd, env });

  const runtimeEnvKeys: string[] = [...LIGHTSAIL_RUNTIME_ENV_KEYS];
  if (!hasAuthSecret(env)) {
    runtimeEnvKeys.push('NEXTAUTH_SECRET');
  }

  const runtimeEnvCheck = buildEnvCheck({
    env,
    id: 'lightsail_runtime_env',
    label: 'Lightsail runtime environment',
    keys: runtimeEnvKeys,
    remediation:
      'Configure DATABASE_URL, AWS_REGION, Cognito, S3, SES, auth secret, container image, and Lightsail bundle env keys.',
  });
  const authEvidence = authSecretEvidence(env);
  if (authEvidence) {
    runtimeEnvCheck.evidence.push(authEvidence);
  }

  const checks: AwsPilotReadinessCheck[] = [
    buildArtifactCheck({
      cwd,
      id: 'aws_architecture_record',
      label: 'Pilot-to-production architecture record',
      artifacts: AWS_PILOT_ARTIFACTS.architecture,
      remediation: 'Record the Lightsail pilot / ECS production decision in docs/architecture.',
    }),
    buildArtifactCheck({
      cwd,
      id: 'lightsail_pilot_plan',
      label: 'Lightsail pilot plan and template',
      artifacts: AWS_PILOT_ARTIFACTS.lightsail,
      remediation:
        'Add the Lightsail pilot plan, runtime env validator, and CloudFormation template.',
    }),
    buildArtifactCheck({
      cwd,
      id: 's3_phi_policy',
      label: 'S3 PHI file policy',
      artifacts: AWS_PILOT_ARTIFACTS.s3Phi,
      remediation: 'Add S3 public access block, Object Lock, retention, and KMS policy artifacts.',
    }),
    buildArtifactCheck({
      cwd,
      id: 'cognito_ses_policy',
      label: 'Cognito MFA and SES policy',
      artifacts: AWS_PILOT_ARTIFACTS.cognitoSes,
      remediation: 'Add Cognito Advanced Security and SES sender policy artifacts.',
    }),
    buildArtifactCheck({
      cwd,
      id: 'rate_limit_dynamodb_artifact',
      label: 'DynamoDB rate-limit artifact',
      artifacts: AWS_PILOT_ARTIFACTS.rateLimit,
      remediation: 'Add the rate-limit DynamoDB table policy and production runbook.',
    }),
    buildArtifactCheck({
      cwd,
      id: 'monitoring_scheduler_artifact',
      label: 'CloudWatch and scheduler artifacts',
      artifacts: AWS_PILOT_ARTIFACTS.monitoring,
      remediation: 'Add CloudWatch alarm baseline and EventBridge schedule artifacts.',
    }),
    buildArtifactCheck({
      cwd,
      id: 'rls_no_store_contract',
      label: 'RLS and no-store contract tests',
      artifacts: AWS_PILOT_ARTIFACTS.tenancyContracts,
      remediation: 'Add tenant isolation and sensitive-response no-store contract tests.',
    }),
    runtimeEnvCheck,
  ];

  const rateLimitReady =
    env.RATE_LIMIT_STORE === 'dynamodb' &&
    isPresent(env.RATE_LIMIT_DDB_TABLE_NAME) &&
    (isPresent(env.RATE_LIMIT_DDB_REGION) || isPresent(env.AWS_REGION));
  checks.push({
    id: 'rate_limit_dynamodb_runtime',
    label: 'DynamoDB rate-limit runtime',
    required_for_phi: true,
    status: rateLimitReady ? 'ready' : 'blocked',
    message: rateLimitReady
      ? 'Production rate limiting is configured for DynamoDB.'
      : 'Production rate limiting is not fully configured for DynamoDB.',
    evidence: [
      ...(env.RATE_LIMIT_STORE === 'dynamodb' ? ['env:RATE_LIMIT_STORE'] : []),
      ...(isPresent(env.RATE_LIMIT_DDB_TABLE_NAME) ? ['env:RATE_LIMIT_DDB_TABLE_NAME'] : []),
      ...(isPresent(env.RATE_LIMIT_DDB_REGION) || isPresent(env.AWS_REGION)
        ? ['env:RATE_LIMIT_DDB_REGION_OR_AWS_REGION']
        : []),
    ],
    remediation: rateLimitReady
      ? undefined
      : 'Set RATE_LIMIT_STORE=dynamodb, RATE_LIMIT_DDB_TABLE_NAME, and RATE_LIMIT_DDB_REGION or AWS_REGION.',
  });

  const backupReady = backupSummary.ready_for_live_drill && backupSummary.live_drill_recorded;
  checks.push({
    id: 'backup_live_drill',
    label: 'Live backup / recovery drill',
    required_for_phi: true,
    status: backupReady ? 'ready' : 'blocked',
    message: backupReady
      ? `Live recovery drill recorded (${backupSummary.live_run_count} run(s)).`
      : 'Live recovery drill is not recorded or not ready to run.',
    evidence: [
      ...backupSummary.files.filter((item) => item.exists).map((item) => item.path),
      ...backupSummary.env.filter((item) => item.exists).map((item) => `env:${item.key}`),
      ...(backupSummary.last_live_run_date
        ? [`live_drill:${backupSummary.last_live_run_date}`]
        : []),
    ],
    remediation: backupReady
      ? undefined
      : 'Run a live RDS/S3/Cognito recovery drill and record RTO/RPO evidence in docs/compliance/backup-recovery-drill.md.',
  });

  checks.push({
    id: 'lightsail_ha_warning',
    label: 'Lightsail high availability warning',
    required_for_phi: false,
    status: 'warning',
    message:
      'Lightsail pilot is a low-cost validation stack and is not the HA production architecture.',
    evidence: existingArtifacts(cwd, AWS_PILOT_ARTIFACTS.architecture),
    remediation: 'Move to ECS/Fargate + ALB + RDS when migration triggers are met.',
  });

  const requiredForPhiChecks = checks.filter((item) => item.required_for_phi);
  const blockedCount = checks.filter((item) => item.status === 'blocked').length;
  const warningCount = checks.filter((item) => item.status === 'warning').length;
  const readyCount = checks.filter((item) => item.status === 'ready').length;

  return {
    mode: 'local_static_no_live_aws',
    overall_status: requiredForPhiChecks.some((item) => item.status === 'blocked')
      ? 'blocked'
      : 'ready',
    phi_input_status: requiredForPhiChecks.some((item) => item.status === 'blocked')
      ? 'blocked'
      : 'local_ready_requires_live_confirmation',
    required_for_phi_count: requiredForPhiChecks.length,
    ready_count: readyCount,
    warning_count: warningCount,
    blocked_count: blockedCount,
    checks,
  };
}

function hasSetPilotEnabled(value: unknown): boolean {
  const record = readJsonObject(value);
  if (!record) return false;
  return record.set_pilot_enabled === true;
}

export function buildPilotReadinessSnapshot(args: {
  cases: PilotReadinessCase[];
  feedback: PilotReadinessFeedback[];
  now?: Date;
  awsPilotReadiness?: AwsPilotReadinessSummary;
}): PilotReadinessSnapshot {
  const now = args.now ?? new Date();
  const awsPilotReadiness = args.awsPilotReadiness ?? buildAwsPilotReadinessSummary();
  const facilityIds = new Set<string>();
  let facilityLinkedCaseCount = 0;
  let setPilotCaseCount = 0;
  let setPilotWithoutFacilityCount = 0;

  for (const careCase of args.cases) {
    const facilityId = careCase.patient.residences[0]?.facility_id ?? null;
    const setPilotEnabled = hasSetPilotEnabled(careCase.required_visit_support);

    if (facilityId) {
      facilityIds.add(facilityId);
      facilityLinkedCaseCount += 1;
    }

    if (setPilotEnabled) {
      setPilotCaseCount += 1;
      if (!facilityId) {
        setPilotWithoutFacilityCount += 1;
      }
    }
  }

  const criticalCount = args.feedback.filter((item) => item.priority === 'critical').length;
  const highCount = args.feedback.filter((item) => item.priority === 'high').length;
  const mediumCount = args.feedback.filter((item) => item.priority === 'medium').length;
  const lowCount = args.feedback.filter((item) => item.priority === 'low').length;
  const blockerCount = args.feedback.filter((item) => isUnresolvedUatBlocker(item)).length;

  const recommendations: string[] = [];
  if (facilityLinkedCaseCount === 0) {
    recommendations.push(
      '施設患者が未確認です。FacilityVisitBatch と自動ルート最適化は Phase 2 移行候補として扱ってください。',
    );
  }
  if (setPilotCaseCount === 0) {
    recommendations.push(
      'セット pilot 対象ケースが未確認です。セット本格機能は pilot 対象明示後に有効化してください。',
    );
  }
  if (blockerCount > 0) {
    recommendations.push(
      `UAT に critical/high が ${blockerCount} 件あります。Phase 2 開始前に優先修正を完了してください。`,
    );
  }
  if (setPilotWithoutFacilityCount > 0) {
    recommendations.push(
      `セット pilot 対象のうち ${setPilotWithoutFacilityCount} 件は施設紐付けがありません。運用導線と患者属性を確認してください。`,
    );
  }
  if (awsPilotReadiness.overall_status === 'blocked') {
    recommendations.push(
      `AWS pilot readiness に ${awsPilotReadiness.blocked_count} 件の未完了チェックがあります。PHI投入前に blocked 項目を解消してください。`,
    );
  }
  if (recommendations.length === 0) {
    recommendations.push('現時点のローカル指標では pilot 前提条件に大きな欠落はありません。');
  }

  return {
    generated_at: now.toISOString(),
    case_summary: {
      active_case_count: args.cases.length,
      facility_linked_case_count: facilityLinkedCaseCount,
      non_facility_case_count: Math.max(0, args.cases.length - facilityLinkedCaseCount),
      facility_count: facilityIds.size,
      set_pilot_case_count: setPilotCaseCount,
      set_pilot_without_facility_count: setPilotWithoutFacilityCount,
    },
    uat_summary: {
      total_feedback: args.feedback.length,
      critical_count: criticalCount,
      high_count: highCount,
      medium_count: mediumCount,
      low_count: lowCount,
      blocker_count: blockerCount,
      recent_feedback: args.feedback.slice(0, 5).map((item) => ({
        id: item.id,
        priority: item.priority,
        feedback: item.feedback,
        checklist_progress: item.checklist_progress,
        source: item.source,
        created_at: item.created_at.toISOString(),
      })),
    },
    decisions: {
      facility_batching: facilityLinkedCaseCount > 0 ? 'ready' : 'phase2_candidate',
      medication_set_workflow: setPilotCaseCount > 0 ? 'ready' : 'phase2_candidate',
      phase2_entry: blockerCount > 0 ? 'blocked' : 'ready',
      pilot_phi_entry: awsPilotReadiness.phi_input_status,
    },
    aws_pilot_summary: awsPilotReadiness,
    recommendations,
  };
}

export async function getPilotReadinessSnapshot(orgId: string): Promise<PilotReadinessSnapshot> {
  const { prisma } = await import('@/lib/db/client');
  const [cases, feedback] = await Promise.all([
    prisma.careCase.findMany({
      where: {
        org_id: orgId,
        status: {
          in: ['assessment', 'active', 'on_hold'],
        },
      },
      select: {
        id: true,
        status: true,
        required_visit_support: true,
        patient: {
          select: {
            id: true,
            name: true,
            residences: {
              where: { is_primary: true },
              select: {
                facility_id: true,
              },
              take: 1,
            },
          },
        },
      },
    }),
    prisma.uatFeedback.findMany({
      where: { org_id: orgId },
      orderBy: [{ created_at: 'desc' }],
      take: 200,
    }),
  ]);

  return buildPilotReadinessSnapshot({
    cases,
    feedback,
  });
}
