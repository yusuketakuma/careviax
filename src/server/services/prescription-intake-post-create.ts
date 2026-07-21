import type { Prisma, PrescriptionSourceType } from '@prisma/client';
import { prisma } from '@/lib/db/client';
import { acquireAdvisoryTxLock } from '@/lib/db/advisory-lock';
import { withOrgContext } from '@/lib/db/rls';
import { japanDateKey, utcDateFromLocalKey } from '@/lib/utils/date-boundary';
import { logger } from '@/lib/utils/logger';
import { detectMedicationChanges, type MedicationChange } from '@/lib/prescription/medication-diff';
import {
  buildDrugIdentityResolutionByCode,
  normalizeMedicationCode,
  resolveMedicationCode,
} from '@/lib/pharmacy/drug-identity-resolution';
import { findCurrentAndPreviousPrescriptionIntakesForMedicationDiff } from '@/server/services/prescription-intake-pair';
import {
  applyPrescriptionSupplyForIntake,
  type ApplyPrescriptionSupplyForIntakeResult,
} from '@/modules/pharmacy/medication-stock/application/apply-prescription-supply';
import type { MedicationProfileSyncLine } from './prescription-intake-contract';
import {
  buildDrugMasterCodeWheres,
  normalizePrescriptionLineDrugMasterId,
} from './prescription-intake-drug-identity';

export async function runPrescriptionIntakePostCreateHooks(args: {
  cycleId: string;
  intakeId: string;
  patientId: string;
  orgId: string;
  userId?: string | null;
  lines: Array<{
    drug_name: string;
    drug_master_id?: string | null;
    drug_code?: string | null;
    dose: string;
    frequency: string;
    days?: number | null;
    start_date?: string | Date | null;
  }>;
  prescriberName: string | null;
  sourceType: PrescriptionSourceType;
}): Promise<{
  medicationChanges: MedicationChange[];
  profileSyncResult: ProfileSyncResult | null;
  prescriptionSupplyResult: ApplyPrescriptionSupplyForIntakeResult | null;
}> {
  let medicationChanges: MedicationChange[] = [];
  let profileSyncResult: ProfileSyncResult | null = null;
  let prescriptionSupplyResult: ApplyPrescriptionSupplyForIntakeResult | null = null;

  const [changeDetectionResult, profileSyncOutcome] = await Promise.allSettled([
    detectIntakeChanges(args.orgId, args.patientId, args.intakeId),
    syncMedicationProfiles(
      args.patientId,
      args.orgId,
      args.lines,
      args.prescriberName,
      args.sourceType,
    ),
  ]);

  if (changeDetectionResult.status === 'fulfilled') {
    medicationChanges = changeDetectionResult.value;
  } else {
    logger.error(
      {
        event: 'prescription_intake.post_create_change_detection_failed',
        operation: 'detect_medication_changes',
        phase: 'post_create',
      },
      changeDetectionResult.reason,
    );
  }

  if (profileSyncOutcome.status === 'fulfilled') {
    profileSyncResult = profileSyncOutcome.value;
  } else {
    logger.error(
      {
        event: 'prescription_intake.post_create_profile_sync_failed',
        operation: 'sync_medication_profiles',
        phase: 'post_create',
      },
      profileSyncOutcome.reason,
    );
  }

  try {
    prescriptionSupplyResult = await withOrgContext(args.orgId, (tx) =>
      applyPrescriptionSupplyForIntake(tx, {
        orgId: args.orgId,
        userId: args.userId ?? 'system',
        intakeId: args.intakeId,
        patientId: args.patientId,
      }),
    );
  } catch (error) {
    logger.error(
      {
        event: 'prescription_intake.post_create_stock_linkage_failed',
        operation: 'apply_prescription_supply',
        phase: 'post_create',
      },
      error,
    );
    // Medication stock linkage is best-effort and must not fail a committed intake.
  }

  return { medicationChanges, profileSyncResult, prescriptionSupplyResult };
}

// ────────────────────────────────────────────────────────────────────────────
// #1 処方差分検知 — 前回処方との変更点を自動検出
// ────────────────────────────────────────────────────────────────────────────

export async function detectIntakeChanges(
  orgId: string,
  patientId: string,
  currentIntakeId: string,
): Promise<MedicationChange[]> {
  const { current, previous } = await findCurrentAndPreviousPrescriptionIntakesForMedicationDiff(
    prisma,
    {
      orgId,
      patientId,
      currentIntakeId,
    },
  );

  if (!current || !previous) return [];

  return detectMedicationChanges(current.lines, previous.lines);
}

// ────────────────────────────────────────────────────────────────────────────
// #2 服薬プロファイル自動同期 — QR 処方確定時に MedicationProfile を更新
// ────────────────────────────────────────────────────────────────────────────

export interface ProfileSyncResult {
  created: number;
  updated: number;
  discontinued: number;
}

export async function syncMedicationProfiles(
  patientId: string,
  orgId: string,
  intakeLines: MedicationProfileSyncLine[],
  prescriberName: string | null,
  sourceType: PrescriptionSourceType,
): Promise<ProfileSyncResult> {
  // DrugMaster is a global reference table and does not participate in the patient-profile
  // read-modify-write invariant, so resolve codes before taking the patient-scoped lock.
  const drugMasterIdByCode = await resolveDrugMasterIdsByPrescriptionCode(intakeLines);

  return withOrgContext(orgId, async (tx) => {
    // MedicationProfile has no partial unique constraint for one current row per drug identity.
    // Serialize the complete read -> create/update -> discontinue sequence per org/patient so a
    // concurrent intake must re-read the first transaction's committed profiles before writing.
    await acquireAdvisoryTxLock(tx, 'medication_profile_sync', `${orgId}:${patientId}`);
    return syncMedicationProfilesInTx(
      tx,
      patientId,
      orgId,
      intakeLines,
      prescriberName,
      sourceType,
      drugMasterIdByCode,
    );
  });
}

export async function syncMedicationProfilesInTx(
  tx: Prisma.TransactionClient,
  patientId: string,
  orgId: string,
  intakeLines: MedicationProfileSyncLine[],
  prescriberName: string | null,
  sourceType: PrescriptionSourceType,
  drugMasterIdByCode: ReadonlyMap<string, string>,
): Promise<ProfileSyncResult> {
  let created = 0;
  let updated = 0;
  let discontinued = 0;

  // 現在の is_current プロファイルを取得
  const existingProfiles = await tx.medicationProfile.findMany({
    where: { org_id: orgId, patient_id: patientId, is_current: true },
  });

  const existingByKey = new Map<string, (typeof existingProfiles)[number]>();
  for (const profile of existingProfiles) {
    for (const key of profileKeys(profile)) {
      if (!existingByKey.has(key)) existingByKey.set(key, profile);
    }
  }
  const incomingKeys = new Set<string>();
  const profilesToCreate: Prisma.MedicationProfileCreateManyInput[] = [];
  // start_date/end_date は 'YYYY-MM-DD' の UTC 深夜 sentinel(new Date('YYYY-MM-DD') 規約)で
  // 保存される日付フィールド。実時刻 new Date() を入れると UTC prod の JST 早朝で前日にずれるため、
  // JST 業務日の UTC 深夜 sentinel を使う。
  const todayDateSentinel = utcDateFromLocalKey(japanDateKey());

  // 新規処方の各行を upsert
  for (const line of intakeLines) {
    const drugCode = normalizePrescriptionDrugCode(line.drug_code);
    const explicitDrugMasterId = normalizePrescriptionLineDrugMasterId(line.drug_master_id);
    const resolvedDrugMasterId =
      explicitDrugMasterId ?? (drugCode ? (drugMasterIdByCode.get(drugCode) ?? null) : null);
    const keys = incomingLineKeys(line, resolvedDrugMasterId, drugCode);
    keys.forEach((key) => incomingKeys.add(key));

    const existing = keys.map((key) => existingByKey.get(key)).find(Boolean);
    const startDate = line.start_date
      ? typeof line.start_date === 'string'
        ? new Date(line.start_date)
        : line.start_date
      : todayDateSentinel;

    if (existing) {
      const shouldRefreshDrugMasterId =
        resolvedDrugMasterId != null && existing.drug_master_id !== resolvedDrugMasterId;
      // 既存プロファイルを更新（dose/frequency またはマスタ解決結果が変わった場合のみ）
      if (
        existing.dose !== line.dose ||
        existing.frequency !== line.frequency ||
        shouldRefreshDrugMasterId
      ) {
        // テナント分離(二重防御): existing.id は org-scoped な findMany 由来だが、この sync は
        // RLS transaction内でも org_id を併用し、患者scopeの二重防御を維持する。
        await tx.medicationProfile.updateMany({
          where: { id: existing.id, org_id: orgId },
          data: {
            ...(shouldRefreshDrugMasterId ? { drug_master_id: resolvedDrugMasterId } : {}),
            dose: line.dose,
            frequency: line.frequency,
            prescriber: prescriberName,
            start_date: startDate,
            end_date: null,
            source: sourceType === 'qr_scan' ? 'qr_scan' : 'prescription',
          },
        });
        updated++;
      }
    } else {
      // 新規プロファイル作成。在宅の多剤併用では新規行が多数になり得るため、行ごとの
      // create(N 回の round-trip)を避け、ループ後に createMany で一括挿入する。
      // 各行は独立した新規プロファイルで相互依存しない。
      profilesToCreate.push({
        org_id: orgId,
        patient_id: patientId,
        drug_name: line.drug_name,
        drug_master_id: resolvedDrugMasterId,
        dose: line.dose,
        frequency: line.frequency,
        prescriber: prescriberName,
        start_date: startDate,
        is_current: true,
        source: sourceType === 'qr_scan' ? 'qr_scan' : 'prescription',
      });
      created++;
    }
  }

  // 新規プロファイルは多剤併用でも 1 回の挿入で済むよう一括作成する。
  if (profilesToCreate.length > 0) {
    await tx.medicationProfile.createMany({ data: profilesToCreate });
  }

  // 今回の処方に含まれない既存プロファイルを中止扱い（一括更新）
  const idsToDiscontinue = existingProfiles
    .filter(
      (profile) =>
        (profile.source === 'prescription' || profile.source === 'qr_scan') &&
        profileKeys(profile).every((key) => !incomingKeys.has(key)),
    )
    .map((profile) => profile.id);

  if (idsToDiscontinue.length > 0) {
    const result = await tx.medicationProfile.updateMany({
      where: { id: { in: idsToDiscontinue }, org_id: orgId },
      data: { is_current: false, end_date: todayDateSentinel },
    });
    discontinued = result.count;
  }

  return { created, updated, discontinued };
}

export function normalizePrescriptionDrugCode(code: string | null | undefined) {
  return normalizeMedicationCode(code);
}

export function profileKeys(profile: { drug_master_id?: string | null; drug_name: string }) {
  const drugMasterId = normalizePrescriptionDrugCode(profile.drug_master_id);
  if (drugMasterId) {
    // Some legacy rows stored a prescription drug code in drug_master_id before DrugMaster ids
    // were consistently synced. Keep that bridge separate from real canonical master identity.
    return [`master:${drugMasterId}`, `legacy-code:${drugMasterId}`];
  }

  const drugName = profile.drug_name.trim();
  return drugName ? [`name:${drugName}`] : [];
}

export function incomingLineKeys(
  line: MedicationProfileSyncLine,
  resolvedDrugMasterId: string | null,
  normalizedDrugCode: string | null,
) {
  const keys: string[] = [];
  if (resolvedDrugMasterId) keys.push(`master:${resolvedDrugMasterId}`);
  if (normalizedDrugCode) {
    keys.push(`code:${normalizedDrugCode}`);
    if (resolvedDrugMasterId) keys.push(`legacy-code:${normalizedDrugCode}`);
  }
  if (normalizedDrugCode && !resolvedDrugMasterId) {
    const drugName = line.drug_name.trim();
    if (drugName) keys.push(`name:${drugName}`);
  }
  if (keys.length > 0) return keys;

  const drugName = line.drug_name.trim();
  return drugName ? [`name:${drugName}`] : [];
}

export async function resolveDrugMasterIdsByPrescriptionCode(lines: MedicationProfileSyncLine[]) {
  const codes = Array.from(
    new Set(
      lines
        .filter((line) => !normalizePrescriptionLineDrugMasterId(line.drug_master_id))
        .map((line) => normalizePrescriptionDrugCode(line.drug_code))
        .filter((code): code is string => Boolean(code)),
    ),
  );
  const byCode = new Map<string, string>();
  if (codes.length === 0) return byCode;

  // 3 列 OR を各列単体の findMany に分割(index が効く)。id で dedupe して結合する。
  const mastersById = new Map<
    string,
    { id: string; yj_code: string; receipt_code: string | null; hot_code: string | null }
  >();
  for (const where of buildDrugMasterCodeWheres(codes)) {
    const rows = await prisma.drugMaster.findMany({
      where,
      select: {
        id: true,
        yj_code: true,
        receipt_code: true,
        hot_code: true,
      },
    });
    for (const row of rows) {
      mastersById.set(row.id, row);
    }
  }
  const masters = [...mastersById.values()];

  // The shared resolver performs deterministic YJ-first resolution and leaves
  // duplicate receipt/HOT candidates unresolved instead of relying on DB order.
  const resolutions = buildDrugIdentityResolutionByCode(masters);
  for (const code of codes) {
    const resolution = resolveMedicationCode(code, resolutions);
    if (resolution.status === 'resolved') {
      byCode.set(code, resolution.drug.id);
    }
  }

  return byCode;
}
