import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/client';
import { batchResolveNames } from '@/lib/utils/name-resolver';

type DbClient = typeof prisma | Prisma.TransactionClient;

export interface PatientStructuredCareItem {
  id: string;
  /** procedure_type(specialProcedureLabels のキー) または narcotic_kind(base/rescue) */
  kind: string;
  is_active: boolean;
  start_date: string | null;
  end_date: string | null;
  source: string;
  confirmed_by: string | null;
  confirmed_by_name: string | null;
  confirmed_at: string | null;
  notes: string | null;
}

export interface PatientStructuredCareList {
  procedures: PatientStructuredCareItem[];
  narcotics: PatientStructuredCareItem[];
}

interface ListArgs {
  orgId: string;
  patientId: string;
  /** 終了済み(is_active=false)も含めるか。既定は実施中(active)のみ */
  includeEnded?: boolean;
}

type StructuredRow = {
  id: string;
  is_active: boolean;
  start_date: Date | null;
  end_date: Date | null;
  source: string;
  confirmed_by: string | null;
  confirmed_at: Date | null;
  notes: string | null;
};

function toItem(
  row: StructuredRow,
  kind: string,
  nameMap: Map<string, string>
): PatientStructuredCareItem {
  return {
    id: row.id,
    kind,
    is_active: row.is_active,
    start_date: row.start_date ? row.start_date.toISOString() : null,
    end_date: row.end_date ? row.end_date.toISOString() : null,
    source: row.source,
    confirmed_by: row.confirmed_by,
    confirmed_by_name: row.confirmed_by ? (nameMap.get(row.confirmed_by) ?? null) : null,
    confirmed_at: row.confirmed_at ? row.confirmed_at.toISOString() : null,
    notes: row.notes,
  };
}

/**
 * 在宅医療処置(PatientMedicalProcedure)/麻薬使用(PatientNarcoticUse)の構造化レイヤを
 * 「現在の状態」中心に取得する(read 専用)。
 * JSON intake が SoT、本表は開始日・確認元(source/confirmed_by)の時系列を補う追加レイヤ。
 */
export async function listPatientStructuredCare(
  db: DbClient,
  args: ListArgs
): Promise<PatientStructuredCareList> {
  const where = {
    org_id: args.orgId,
    patient_id: args.patientId,
    ...(args.includeEnded ? {} : { is_active: true }),
  };
  const orderBy = [
    { is_active: 'desc' as const },
    { start_date: 'desc' as const },
    { created_at: 'desc' as const },
  ];

  const [procedures, narcotics] = await Promise.all([
    db.patientMedicalProcedure.findMany({ where, orderBy }),
    db.patientNarcoticUse.findMany({ where, orderBy }),
  ]);

  const actorIds = Array.from(
    new Set(
      [...procedures, ...narcotics]
        .map((row) => row.confirmed_by)
        .filter((id): id is string => !!id)
    )
  );
  const nameMap = await batchResolveNames(db as typeof prisma, args.orgId, actorIds);

  return {
    procedures: procedures.map((row) => toItem(row, row.procedure_type, nameMap)),
    narcotics: narcotics.map((row) => toItem(row, row.narcotic_kind, nameMap)),
  };
}
