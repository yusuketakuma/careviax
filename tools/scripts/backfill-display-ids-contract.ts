import {
  allocateDisplayIdRange,
  allocateGlobalDisplayIdRange,
  type DisplayIdModel,
  type DisplayIdPrefix,
} from '@/lib/db/display-id';

type BackfillMode = 'dry-run' | 'apply';
type DisplayIdBackfillOrgSource = 'direct' | 'handoffBoardParent' | 'global';

export type DisplayIdBackfillOptions = {
  mode: BackfillMode;
  models: DisplayIdModel[];
  maxRows: number;
  batchSize: number;
  sampleLimit: number;
  orgId: string | null;
  includeParentScoped: boolean;
  jsonOutputPath: string | null;
  markdownOutputPath: string | null;
};

export type DisplayIdBackfillRow = {
  id: string;
  orgId: string;
  createdAt: Date;
};

export type DisplayIdOrgCount = {
  orgId: string;
  count: number;
};

export type DisplayIdMaxSequence = {
  orgId: string;
  maxSequence: bigint;
};

export type DisplayIdSequenceMismatch = {
  orgId: string;
  expectedAtLeastNextValue: string;
  actualNextValue: string | null;
};

export type DisplayIdBackfillIssue = {
  name: string;
  severity: 'error' | 'warning';
  model?: string;
  orgId?: string;
  details?: string;
};

export type DisplayIdBackfillOrgPreview = {
  model: DisplayIdModel;
  orgId: string;
  rowsToBackfill: number;
  firstPreviewDisplayId: string | null;
  lastPreviewDisplayId: string | null;
};

export type DisplayIdBackfillModelResult = {
  model: DisplayIdModel;
  totalRows: number;
  nullDisplayIdRows: number;
  duplicateDisplayIdGroups: number;
  invalidFormatRows: number;
  sequenceMismatches: DisplayIdSequenceMismatch[];
  backfilledRows: number;
  orgs: DisplayIdBackfillOrgPreview[];
};

export type DisplayIdBackfillResult = {
  ok: boolean;
  mode: BackfillMode;
  dryRun: boolean;
  generatedAt: string;
  targetModels: DisplayIdModel[];
  maxRows: number;
  batchSize: number;
  sampleLimit: number;
  orgId: string | null;
  models: Record<string, DisplayIdBackfillModelResult>;
  orgs: DisplayIdBackfillOrgPreview[];
  issues: DisplayIdBackfillIssue[];
  postChecks: Array<{
    model: DisplayIdModel;
    ok: boolean;
    nullDisplayIdRows: number;
    duplicateDisplayIdGroups: number;
    invalidFormatRows: number;
    sequenceMismatches: DisplayIdSequenceMismatch[];
  }>;
};

export type DisplayIdBackfillModelConfig = {
  model: DisplayIdModel;
  tableName: string;
  prefix: DisplayIdPrefix;
  orgSource: DisplayIdBackfillOrgSource;
};

export type DisplayIdBackfillAdapter = {
  countRows(config: DisplayIdBackfillModelConfig, orgId: string | null): Promise<number>;
  countNullRows(config: DisplayIdBackfillModelConfig, orgId: string | null): Promise<number>;
  countDuplicateDisplayIds(
    config: DisplayIdBackfillModelConfig,
    orgId: string | null,
  ): Promise<number>;
  countInvalidDisplayIds(
    config: DisplayIdBackfillModelConfig,
    orgId: string | null,
  ): Promise<number>;
  listNullRowsByOrg(
    config: DisplayIdBackfillModelConfig,
    orgId: string | null,
  ): Promise<DisplayIdOrgCount[]>;
  readMaxDisplaySequenceByOrg(
    config: DisplayIdBackfillModelConfig,
    orgId: string | null,
  ): Promise<DisplayIdMaxSequence[]>;
  readSequenceNextValue(orgId: string, prefix: DisplayIdPrefix): Promise<bigint | null>;
  ensureSequenceAtLeast(orgId: string, prefix: DisplayIdPrefix, nextValue: bigint): Promise<void>;
  selectNullRowsForOrg(
    config: DisplayIdBackfillModelConfig,
    orgId: string,
    limit: number,
  ): Promise<DisplayIdBackfillRow[]>;
  updateDisplayId(
    config: DisplayIdBackfillModelConfig,
    row: DisplayIdBackfillRow,
    displayId: string,
  ): Promise<number>;
};

export type DisplayIdBackfillClient = {
  $transaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T>;
};

export type DisplayIdRawExecutor = {
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
  $executeRawUnsafe(query: string, ...values: unknown[]): Promise<number>;
};

export type DisplayIdBackfillDeps = {
  createAdapter: (executor: unknown) => DisplayIdBackfillAdapter;
  allocateRange: typeof allocateDisplayIdRange;
  allocateGlobalRange: typeof allocateGlobalDisplayIdRange;
  now: () => Date;
};
