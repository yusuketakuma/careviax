import {
  ClinicalRawVaultAccessPolicy,
  type Prisma,
  Prisma as PrismaNamespace,
} from '@prisma/client';
import { withOrgContext } from '@/lib/db/rls';

const DEFAULT_PURGE_LIMIT = 100;
const MAX_PURGE_LIMIT = 500;

export const CLINICAL_RAW_VAULT_PURGE_INVALID_LIMIT = 'invalid_limit';
export const CLINICAL_RAW_VAULT_PURGE_FAILED = 'clinical_raw_vault_purge_failed';

const PURGEABLE_RAW_VAULT_POLICIES = [
  ClinicalRawVaultAccessPolicy.step_up_required,
  ClinicalRawVaultAccessPolicy.system_replay_only,
] as const;

type ClinicalRawVaultRetentionTx = Pick<Prisma.TransactionClient, 'clinicalFhirRawResourceVault'>;

type RunInOrgContext = <T>(
  orgId: string,
  work: (tx: ClinicalRawVaultRetentionTx) => Promise<T>,
) => Promise<T>;

export interface PurgeExpiredClinicalFhirRawResourceVaultOptions {
  readonly orgId: string;
  readonly now?: Date;
  readonly limit?: number;
}

export interface PurgeExpiredClinicalFhirRawResourceVaultResult {
  readonly processedCount: number;
  readonly deletedCount: number;
  readonly scannedCount: number;
  readonly errors: string[];
}

export interface PurgeExpiredClinicalFhirRawResourceVaultTestOptions {
  readonly runInOrgContext?: RunInOrgContext;
}

function normalizePurgeLimit(value: number | undefined) {
  if (value === undefined) return DEFAULT_PURGE_LIMIT;
  if (!Number.isFinite(value)) return 0;
  const normalized = Math.trunc(value);
  if (normalized <= 0) return 0;
  return Math.min(normalized, MAX_PURGE_LIMIT);
}

export function buildClinicalFhirRawVaultPurgeWhere(
  orgId: string,
  now: Date,
): Prisma.ClinicalFhirRawResourceVaultWhereInput {
  return {
    org_id: orgId,
    expires_at: { lte: now },
    access_policy: { in: [...PURGEABLE_RAW_VAULT_POLICIES] },
    OR: [{ legal_hold_until: null }, { legal_hold_until: { lte: now } }],
  };
}

function zeroResult(errors: string[] = []): PurgeExpiredClinicalFhirRawResourceVaultResult {
  return {
    processedCount: 0,
    deletedCount: 0,
    scannedCount: 0,
    errors,
  };
}

async function purgeWithinOrg(
  tx: ClinicalRawVaultRetentionTx,
  options: Required<Pick<PurgeExpiredClinicalFhirRawResourceVaultOptions, 'orgId' | 'now'>> & {
    limit: number;
  },
): Promise<PurgeExpiredClinicalFhirRawResourceVaultResult> {
  if (options.limit <= 0) {
    return zeroResult([CLINICAL_RAW_VAULT_PURGE_INVALID_LIMIT]);
  }

  const where = buildClinicalFhirRawVaultPurgeWhere(options.orgId, options.now);
  const candidates = await tx.clinicalFhirRawResourceVault.findMany({
    where,
    orderBy: [{ expires_at: 'asc' }, { id: 'asc' }],
    take: options.limit,
    select: { id: true },
  });

  if (candidates.length === 0) {
    return zeroResult();
  }

  const deleteResult = await tx.clinicalFhirRawResourceVault.deleteMany({
    where: {
      ...where,
      id: { in: candidates.map((row) => row.id) },
    },
  });

  return {
    processedCount: deleteResult.count,
    deletedCount: deleteResult.count,
    scannedCount: candidates.length,
    errors: [],
  };
}

export async function purgeExpiredClinicalFhirRawResourceVault(
  options: PurgeExpiredClinicalFhirRawResourceVaultOptions,
  testOptions: PurgeExpiredClinicalFhirRawResourceVaultTestOptions = {},
): Promise<PurgeExpiredClinicalFhirRawResourceVaultResult> {
  const normalized = {
    orgId: options.orgId,
    now: options.now ?? new Date(),
    limit: normalizePurgeLimit(options.limit),
  };
  const runInOrgContext =
    testOptions.runInOrgContext ??
    (<T>(orgId: string, work: (tx: ClinicalRawVaultRetentionTx) => Promise<T>) =>
      withOrgContext(orgId, work as never));

  try {
    return await runInOrgContext(normalized.orgId, (tx) => purgeWithinOrg(tx, normalized));
  } catch (error) {
    if (error instanceof PrismaNamespace.PrismaClientKnownRequestError) {
      return zeroResult([CLINICAL_RAW_VAULT_PURGE_FAILED]);
    }
    return zeroResult([CLINICAL_RAW_VAULT_PURGE_FAILED]);
  }
}
