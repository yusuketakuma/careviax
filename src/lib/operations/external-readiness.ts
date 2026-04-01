import fs from 'node:fs';
import path from 'node:path';

export type ReadinessPathCheck = {
  path: string;
  exists: boolean;
};

export type ReadinessEnvCheck = {
  key: string;
  exists: boolean;
};

export type PmdaOnboardingSummary = {
  registration: {
    medinavi_registered: boolean;
    my_drug_collection_registered: boolean;
  };
  distribution_urls: {
    full_configured: boolean;
    delta_configured: boolean;
  };
  docs: ReadinessPathCheck[];
  ready_for_import_test: boolean;
  next_steps: string[];
};

export type BackupDrillSummary = {
  files: ReadinessPathCheck[];
  env: ReadinessEnvCheck[];
  ready_for_live_drill: boolean;
  recorded_runs: Array<{
    date: string;
    operator: string;
    result: string;
    duration: string;
    notes: string;
    mode: 'live' | 'tabletop' | 'unknown';
  }>;
  live_drill_recorded: boolean;
  live_run_count: number;
  last_live_run_date: string | null;
  next_steps: string[];
};

export type IsmsReadinessSummary = {
  docs: ReadinessPathCheck[];
  comparison_table_started: boolean;
  decision_memo_started: boolean;
  ready_for_quote_request: boolean;
  next_steps: string[];
};

const PMDA_REQUIRED_DOCS = [
  'docs/operations/pmda-onboarding-runbook.md',
  'docs/compliance/change-management.md',
  'docs/compliance/responsibility-matrix.md',
];

const BACKUP_REQUIRED_PATHS = [
  'docs/compliance/backup-recovery-drill.md',
  'docs/compliance/rds-configuration.md',
  'infra/file-storage-bucket-policy.json',
  'infra/s3-kms-key-policy.json',
  'infra/vpc-security-groups.json',
];

const BACKUP_REQUIRED_ENV = ['DATABASE_URL', 'AWS_REGION'];
const BACKUP_DRILL_DOC = 'docs/compliance/backup-recovery-drill.md';

const ISMS_REQUIRED_DOCS = [
  'docs/compliance/isms-kickoff-checklist.md',
  'docs/compliance/isms-vendor-comparison-template.md',
  'docs/compliance/network-security-design.md',
  'docs/compliance/mhlw-v6-mapping.md',
  'docs/compliance/meti-mic-v1.1-mapping.md',
];

function toChecks(root: string, pathsToCheck: string[]): ReadinessPathCheck[] {
  return pathsToCheck.map((item) => ({
    path: item,
    exists: fs.existsSync(path.join(root, item)),
  }));
}

function readTextIfExists(root: string, filePath: string) {
  const absolutePath = path.join(root, filePath);
  if (!fs.existsSync(absolutePath)) {
    return '';
  }
  return fs.readFileSync(absolutePath, 'utf8');
}

function parseMarkdownTableRows(markdown: string) {
  return markdown
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('|') && !line.includes('|---'));
}

function classifyBackupDrillMode(args: { result: string; notes: string }) {
  const source = `${args.result} ${args.notes}`.toLowerCase();
  if (source.includes('[mode:live]') || /(^|[\s/])(live|実地|本番相当)/.test(source)) {
    return 'live' as const;
  }
  if (source.includes('[mode:tabletop]') || /(^|[\s/])(tabletop|机上訓練|前提確認)/.test(source)) {
    return 'tabletop' as const;
  }
  return 'unknown' as const;
}

export function getPmdaOnboardingSummary(args?: {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}): PmdaOnboardingSummary {
  const cwd = args?.cwd ?? process.cwd();
  const env = args?.env ?? process.env;
  const fullUrl = env.PMDA_PACKAGE_INSERT_FULL_URL ?? '';
  const deltaUrl = env.PMDA_PACKAGE_INSERT_DELTA_URL ?? '';
  const docs = toChecks(cwd, PMDA_REQUIRED_DOCS);
  const medinaviRegistered = env.PMDA_MEDINAVI_REGISTERED === 'true';
  const myDrugCollectionRegistered = env.PMDA_MY_DRUG_COLLECTION_REGISTERED === 'true';
  const readyForImportTest =
    docs.every((item) => item.exists) &&
    medinaviRegistered &&
    myDrugCollectionRegistered &&
    Boolean(fullUrl) &&
    Boolean(deltaUrl);

  return {
    registration: {
      medinavi_registered: medinaviRegistered,
      my_drug_collection_registered: myDrugCollectionRegistered,
    },
    distribution_urls: {
      full_configured: Boolean(fullUrl),
      delta_configured: Boolean(deltaUrl),
    },
    docs,
    ready_for_import_test: readyForImportTest,
    next_steps: [
      'PMDA メディナビへ運用担当の共通メールアドレスで登録する',
      'マイ医薬品集サービスで全量 ZIP と指定期間更新 ZIP の取得権限を有効化する',
      'Secrets Manager か環境変数に PMDA_PACKAGE_INSERT_FULL_URL / PMDA_PACKAGE_INSERT_DELTA_URL を設定する',
      '設定後に管理画面または /api/drug-master-imports/pmda で疎通確認する',
    ],
  };
}

export function formatPmdaOnboardingMarkdown(summary: PmdaOnboardingSummary) {
  return `# PMDA Onboarding Check

- medinavi_registered: ${summary.registration.medinavi_registered ? 'yes' : 'no'}
- my_drug_collection_registered: ${summary.registration.my_drug_collection_registered ? 'yes' : 'no'}
- full_url_configured: ${summary.distribution_urls.full_configured ? 'yes' : 'no'}
- delta_url_configured: ${summary.distribution_urls.delta_configured ? 'yes' : 'no'}
- ready_for_import_test: ${summary.ready_for_import_test ? 'yes' : 'no'}

## Docs
${summary.docs.map((item) => `- ${item.exists ? '[x]' : '[ ]'} ${item.path}`).join('\n')}

## Next Steps
${summary.next_steps.map((item) => `- ${item}`).join('\n')}
`;
}

export function getBackupDrillSummary(args?: {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}): BackupDrillSummary {
  const cwd = args?.cwd ?? process.cwd();
  const env = args?.env ?? process.env;
  const files = toChecks(cwd, BACKUP_REQUIRED_PATHS);
  const envChecks = BACKUP_REQUIRED_ENV.map((key) => ({
    key,
    exists: Boolean(env[key]),
  }));
  const drillDoc = readTextIfExists(cwd, BACKUP_DRILL_DOC);
  const recordedRuns = parseMarkdownTableRows(drillDoc)
    .map((line) => line.split('|').map((cell) => cell.trim()))
    .filter((cells) => cells.length >= 7)
    .map((cells) => ({
      date: cells[1] ?? '',
      operator: cells[2] ?? '',
      result: cells[3] ?? '',
      duration: cells[4] ?? '',
      notes: cells[5] ?? '',
      mode: classifyBackupDrillMode({
        result: cells[3] ?? '',
        notes: cells[5] ?? '',
      }),
    }))
    .filter((row) => row.date !== '実施日' && row.date !== '未実施' && row.date.length > 0);
  const liveRuns = recordedRuns.filter((row) => row.mode === 'live');

  return {
    files,
    env: envChecks,
    ready_for_live_drill: files.every((item) => item.exists) && envChecks.every((item) => item.exists),
    recorded_runs: recordedRuns,
    live_drill_recorded: liveRuns.length > 0,
    live_run_count: liveRuns.length,
    last_live_run_date: liveRuns.at(-1)?.date ?? null,
    next_steps: [
      '本番相当権限で RDS / S3 / Cognito の live drill を実施する',
      '所要時間と失敗点を docs/compliance/backup-recovery-drill.md に記録する',
      'RTO/RPO を満たせない箇所があれば IaC と runbook を更新する',
    ],
  };
}

export function getIsmsReadinessSummary(args?: {
  cwd?: string;
}): IsmsReadinessSummary {
  const cwd = args?.cwd ?? process.cwd();
  const docs = toChecks(cwd, ISMS_REQUIRED_DOCS);
  const vendorTemplate = readTextIfExists(cwd, 'docs/compliance/isms-vendor-comparison-template.md');
  const comparisonTableStarted = vendorTemplate
    .split('\n')
    .some((line) => /^\|\s*(会社名|担当者|初回見積|年間費用|初回審査候補月)\s*\|/.test(line) && !/\|\s*\|\s*\|\s*\|$/.test(line));
  const decisionMemoStarted = vendorTemplate
    .split('\n')
    .some((line) => /^- (認証スコープ|予算上限|キックオフ候補日|プロジェクトオーナー|事務局|次アクション):\s*\S+/.test(line));

  return {
    docs,
    comparison_table_started: comparisonTableStarted,
    decision_memo_started: decisionMemoStarted,
    ready_for_quote_request: docs.every((item) => item.exists),
    next_steps: [
      '審査機関候補 2 社以上へ見積依頼を出す',
      'isms-vendor-comparison-template.md に比較結果と予算上限を記録する',
      'キックオフ日程、オーナー、スコープを経営判断として確定する',
    ],
  };
}
