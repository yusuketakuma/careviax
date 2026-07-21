import type { Prisma } from '@prisma/client';
import {
  buildDrugIdentityResolutionByCode,
  normalizeMedicationCode,
  resolveMedicationCode,
  type PrescriptionDrugCodeSystem,
} from '@/lib/pharmacy/drug-identity-resolution';
import type {
  CreateIntakeLineInput,
  ResolvedCreateIntakeLineInput,
} from './prescription-intake-contract';

export function normalizePrescriptionDrugCode(code: string | null | undefined) {
  return normalizeMedicationCode(code);
}

export function normalizePrescriptionLineSourceDrugCodeType(
  value: string | null | undefined,
): Exclude<PrescriptionDrugCodeSystem, 'jan'> | null {
  const normalized = value?.trim();
  return normalized === 'yj' || normalized === 'receipt' || normalized === 'hot'
    ? normalized
    : null;
}

export function readPrescriptionLineSourceDrugCode(line: CreateIntakeLineInput) {
  return normalizePrescriptionDrugCode(line.source_drug_code ?? line.drug_code);
}

export function readPrescriptionLineDrugIdentityCodes(line: CreateIntakeLineInput) {
  const entries = [
    normalizePrescriptionDrugCode(line.source_drug_code),
    normalizePrescriptionDrugCode(line.drug_code),
  ];
  return Array.from(new Set(entries.filter((code): code is string => Boolean(code))));
}

export function normalizePrescriptionLineDrugMasterId(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : null;
}

export type ResolveCreateIntakeLineDrugIdentitiesResult =
  | { ok: true; lines: ResolvedCreateIntakeLineInput[] }
  | { ok: false; drugMasterIds: string[] };

/**
 * DrugMaster は org_id を持たないグローバル参照表(RLS 対象外)。よって解決系の読み取りは
 * RLS 付き interactive transaction の外(通常の `prisma`)からでも安全に実行できる。
 * ここでは `tx`(トランザクション内)と `prisma`(トランザクション外)の双方を受けられるよう、
 * `findMany` だけを要求する最小インターフェースに絞る。
 */
export type DrugMasterReader = {
  drugMaster: Pick<Prisma.TransactionClient['drugMaster'], 'findMany'>;
};

/**
 * yj_code / receipt_code / hot_code の 3 列 OR 検索を、各列単体の WHERE に分割する。
 * 3 列同時 OR はプランナが seq scan に落ちやすく(RUN-20260622-001: 直 fetch 33.7s)、
 * 各列には個別 index(@@index([yj_code]) 等)があるため、列ごとに分けると index が効く。
 * 呼び出し側は返した WHERE ごとに findMany し、結果を id / yj_code で dedupe して結合する。
 */
export function buildDrugMasterCodeWheres(codes: string[]): Prisma.DrugMasterWhereInput[] {
  if (codes.length === 0) return [];
  return [{ yj_code: { in: codes } }, { receipt_code: { in: codes } }, { hot_code: { in: codes } }];
}

/**
 * 書き込み transaction の外で先に済ませておける読み取り検証結果。interactive tx の
 * timeout 予算をグローバル参照表(DrugMaster)の読み取りに費やさないよう、
 * {@link createPrescriptionIntake} が事前計算して {@link createPrescriptionIntakeInTx} へ渡す。
 * 未指定(QR フロー等、tx 内で行が確定するケース)のときは従来どおり tx 内で解決する。
 */
export type PreparedIntakeReads = {
  drugIdentityResolution: ResolveCreateIntakeLineDrugIdentitiesResult;
  outpatientInjectionBlockedLines: Array<{
    line_number: number;
    drug_name: string;
    reason: string;
  }>;
};

/**
 * 書き込み+整合性再確認だけを担う短い tx の明示 timeout。読み取り検証を tx 外へ前倒しした後の
 * 残り作業(intake/line 作成・rx 採番・fax/inquiry・createDispenseDraft の状態遷移)向けに、
 * interactive tx 既定の 5s より余裕を持たせつつ上限を明示する。
 */
export const PRESCRIPTION_INTAKE_WRITE_TX_TIMEOUT_MS = 15_000;
export const PRESCRIPTION_INTAKE_WRITE_TX_MAX_WAIT_MS = 5_000;

export async function resolveCreateIntakeLineDrugIdentities(
  client: DrugMasterReader,
  lines: CreateIntakeLineInput[],
): Promise<ResolveCreateIntakeLineDrugIdentitiesResult> {
  const sourceCodes = Array.from(
    new Set(
      lines
        .flatMap((line) => readPrescriptionLineDrugIdentityCodes(line))
        .filter((code): code is string => Boolean(code)),
    ),
  );
  const explicitDrugMasterIds = Array.from(
    new Set(
      lines
        .map((line) => normalizePrescriptionLineDrugMasterId(line.drug_master_id))
        .filter((id): id is string => Boolean(id)),
    ),
  );
  // 3 列 OR を各列単体の findMany に分割し(index が効く)、id で dedupe して結合する。
  // 明示 drug_master_id は id 単体の findMany を追加する。DrugMaster はグローバル参照表のため
  // 同一トランザクション接続を跨がないよう await を直列に回す(並列化はしない)。
  const drugMasterWheres: Prisma.DrugMasterWhereInput[] = [
    ...buildDrugMasterCodeWheres(sourceCodes),
    ...(explicitDrugMasterIds.length > 0 ? [{ id: { in: explicitDrugMasterIds } }] : []),
  ];
  const masterById = new Map<
    string,
    { id: string; yj_code: string; receipt_code: string | null; hot_code: string | null }
  >();
  for (const where of drugMasterWheres) {
    const rows = await client.drugMaster.findMany({
      where,
      select: {
        id: true,
        yj_code: true,
        receipt_code: true,
        hot_code: true,
      },
    });
    for (const row of rows) {
      masterById.set(row.id, row);
    }
  }
  const masters = [...masterById.values()];
  const invalidExplicitDrugMasterIds = explicitDrugMasterIds.filter((id) => {
    const master = masterById.get(id);
    return !master || !normalizeMedicationCode(master.yj_code);
  });
  if (invalidExplicitDrugMasterIds.length > 0) {
    return { ok: false, drugMasterIds: invalidExplicitDrugMasterIds };
  }

  const resolutions = buildDrugIdentityResolutionByCode(masters);
  const conflictingExplicitDrugMasterIds = Array.from(
    new Set(
      lines.flatMap((line) => {
        const explicitDrugMasterId = normalizePrescriptionLineDrugMasterId(line.drug_master_id);
        if (!explicitDrugMasterId) return [];
        return readPrescriptionLineDrugIdentityCodes(line).some((code) => {
          const resolution = resolveMedicationCode(code, resolutions);
          return resolution.status === 'resolved' && resolution.drug.id !== explicitDrugMasterId;
        })
          ? [explicitDrugMasterId]
          : [];
      }),
    ),
  );
  if (conflictingExplicitDrugMasterIds.length > 0) {
    return { ok: false, drugMasterIds: conflictingExplicitDrugMasterIds };
  }

  const resolvedLines: ResolvedCreateIntakeLineInput[] = lines.map((line) => {
    const sourceCode = readPrescriptionLineSourceDrugCode(line);
    const resolution = resolveMedicationCode(sourceCode, resolutions);
    const explicitDrugMasterId = normalizePrescriptionLineDrugMasterId(line.drug_master_id);
    const explicitDrugMaster = explicitDrugMasterId ? masterById.get(explicitDrugMasterId) : null;
    const explicitSourceCodeType = normalizePrescriptionLineSourceDrugCodeType(
      line.source_drug_code_type,
    );

    if (explicitDrugMaster) {
      const canonicalDrugCode =
        normalizeMedicationCode(explicitDrugMaster.yj_code) ?? explicitDrugMaster.yj_code;
      return {
        ...line,
        drug_code: canonicalDrugCode,
        drug_master_id: explicitDrugMaster.id,
        source_drug_code: sourceCode,
        source_drug_code_type: sourceCode
          ? resolution.status === 'resolved'
            ? resolution.sourceCodeSystem
            : explicitSourceCodeType
          : null,
        drug_resolution_status: 'resolved' as const,
      };
    }

    if (resolution.status === 'resolved') {
      return {
        ...line,
        drug_code: resolution.canonicalDrugCode,
        drug_master_id: resolution.drug.id,
        source_drug_code: resolution.sourceCode,
        source_drug_code_type: resolution.sourceCodeSystem,
        drug_resolution_status: 'resolved',
      };
    }

    if (resolution.status === 'ambiguous_code') {
      return {
        ...line,
        drug_code: null,
        drug_master_id: null,
        source_drug_code: resolution.sourceCode,
        source_drug_code_type: resolution.sourceCodeSystem,
        drug_resolution_status: 'ambiguous_code',
      };
    }

    if (resolution.status === 'code_not_found') {
      return {
        ...line,
        drug_code: null,
        drug_master_id: null,
        source_drug_code: resolution.sourceCode,
        source_drug_code_type: explicitSourceCodeType,
        drug_resolution_status: 'code_not_found',
      };
    }

    return {
      ...line,
      drug_code: null,
      drug_master_id: null,
      source_drug_code: null,
      source_drug_code_type: null,
      drug_resolution_status: 'missing_code',
    };
  });

  return { ok: true, lines: resolvedLines };
}
