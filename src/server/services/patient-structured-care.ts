import type { Prisma } from '@prisma/client';
import type { HomeVisitIntake } from '@/lib/patient/home-visit-intake';

/**
 * 在宅医療処置(special_medical_procedures)/麻薬(narcotics_base/rescue)を、
 * merged な home_visit_intake から構造化テーブル(PatientMedicalProcedure/PatientNarcoticUse)へ反映する。
 *
 * 移行方針(JSON継続SoT): home_visit_intake(JSON)が SoT のまま、本表は追加レイヤとして「現在の状態」を保つ。
 * - intake に在って表に無い項目 → 開始日付きで active 行を作成
 * - 表に在って intake に無い項目 → end_date を入れて is_active=false
 * 追加された項目(=開始)は呼び出し側で確認タスク(麻薬開始→残数確認 / TPN開始→無菌調製確認)に使う。
 */
export type StructuredCareTxClient = {
  patientMedicalProcedure: Pick<
    Prisma.TransactionClient['patientMedicalProcedure'],
    'findMany' | 'create' | 'updateMany'
  >;
  patientNarcoticUse: Pick<
    Prisma.TransactionClient['patientNarcoticUse'],
    'findMany' | 'create' | 'updateMany'
  >;
};

export interface SyncStructuredHomeCareArgs {
  orgId: string;
  patientId: string;
  caseId: string;
  intake: HomeVisitIntake | null;
  source?: string;
  confirmedBy?: string | null;
  /** 開始日(ローカル当日のUTC深夜) */
  startDate: Date;
}

export interface SyncStructuredHomeCareResult {
  proceduresAdded: string[];
  narcoticsAdded: string[];
}

export async function syncStructuredHomeCare(
  tx: StructuredCareTxClient,
  args: SyncStructuredHomeCareArgs
): Promise<SyncStructuredHomeCareResult> {
  // intake が無い = 在宅情報を更新していない。既存の構造化行には触れない(誤って end しない)。
  if (!args.intake) {
    return { proceduresAdded: [], narcoticsAdded: [] };
  }

  const source = args.source ?? 'patient_detail_edit';

  const desiredProcedures = Array.from(
    new Set((args.intake?.special_medical_procedures ?? []).filter((p) => typeof p === 'string'))
  );
  const proceduresAdded = await reconcileSet(tx.patientMedicalProcedure, {
    orgId: args.orgId,
    patientId: args.patientId,
    caseId: args.caseId,
    column: 'procedure_type',
    desired: desiredProcedures,
    source,
    confirmedBy: args.confirmedBy ?? null,
    startDate: args.startDate,
  });

  const desiredNarcotics: string[] = [];
  if (args.intake?.narcotics_base) desiredNarcotics.push('base');
  if (args.intake?.narcotics_rescue) desiredNarcotics.push('rescue');
  const narcoticsAdded = await reconcileSet(tx.patientNarcoticUse, {
    orgId: args.orgId,
    patientId: args.patientId,
    caseId: args.caseId,
    column: 'narcotic_kind',
    desired: desiredNarcotics,
    source,
    confirmedBy: args.confirmedBy ?? null,
    startDate: args.startDate,
  });

  return { proceduresAdded, narcoticsAdded };
}

type ReconcileDelegate = {
  findMany(args: {
    where: Record<string, unknown>;
    select: Record<string, boolean>;
  }): Promise<Array<Record<string, unknown>>>;
  create(args: { data: Record<string, unknown> }): Promise<unknown>;
  updateMany(args: {
    where: Record<string, unknown>;
    data: Record<string, unknown>;
  }): Promise<unknown>;
};

async function reconcileSet(
  delegate: ReconcileDelegate,
  args: {
    orgId: string;
    patientId: string;
    caseId: string;
    column: 'procedure_type' | 'narcotic_kind';
    desired: string[];
    source: string;
    confirmedBy: string | null;
    startDate: Date;
  }
): Promise<string[]> {
  const existing = await delegate.findMany({
    where: { org_id: args.orgId, patient_id: args.patientId, is_active: true },
    select: { id: true, [args.column]: true },
  });

  const existingValues = new Set(existing.map((row) => String(row[args.column])));
  const desiredSet = new Set(args.desired);

  const toAdd = args.desired.filter((value) => !existingValues.has(value));
  const removedIds = existing
    .filter((row) => !desiredSet.has(String(row[args.column])))
    .map((row) => String(row.id));

  for (const value of toAdd) {
    await delegate.create({
      data: {
        org_id: args.orgId,
        patient_id: args.patientId,
        case_id: args.caseId,
        [args.column]: value,
        is_active: true,
        start_date: args.startDate,
        source: args.source,
        confirmed_by: args.confirmedBy,
      },
    });
  }

  if (removedIds.length > 0) {
    await delegate.updateMany({
      where: { id: { in: removedIds } },
      data: { is_active: false, end_date: args.startDate },
    });
  }

  return toAdd;
}
