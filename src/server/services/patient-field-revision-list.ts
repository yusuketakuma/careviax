import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/client';
import { batchResolveNames } from '@/lib/utils/name-resolver';

type DbClient = typeof prisma | Prisma.TransactionClient;

export interface PatientFieldRevisionListItem {
  id: string;
  category: string;
  field_key: string;
  field_label: string | null;
  value_label: string | null;
  previous: Prisma.JsonValue | null;
  current: Prisma.JsonValue | null;
  source: string;
  source_visit_record_id: string | null;
  change_reason: string | null;
  importance: string;
  confirmed_by: string | null;
  confirmed_by_name: string | null;
  confirmed_at: string | null;
  valid_from: string;
  valid_to: string | null;
  is_current: boolean;
  updated_by: string;
  updated_by_name: string | null;
  created_at: string;
}

interface ListArgs {
  orgId: string;
  patientId: string;
  category?: string;
  limit?: number;
}

/**
 * 患者項目の変更履歴(PatientFieldRevision)を時系列(新しい順)で取得し、
 * 更新者/確認者の User ID を氏名へ解決した表示用リストを返す。
 * 変更履歴タイムラインUI と項目メタ表示の供給源(read 専用)。
 */
export async function listPatientFieldRevisions(
  db: DbClient,
  args: ListArgs
): Promise<PatientFieldRevisionListItem[]> {
  const rows = await db.patientFieldRevision.findMany({
    where: {
      org_id: args.orgId,
      patient_id: args.patientId,
      ...(args.category ? { category: args.category } : {}),
    },
    orderBy: [{ created_at: 'desc' }],
    take: args.limit ?? 50,
  });

  const actorIds = Array.from(
    new Set(
      rows.flatMap((row) => [row.updated_by, row.confirmed_by]).filter((id): id is string => !!id)
    )
  );
  const nameMap = await batchResolveNames(db as typeof prisma, args.orgId, actorIds);

  return rows.map((row) => ({
    id: row.id,
    category: row.category,
    field_key: row.field_key,
    field_label: row.field_label,
    value_label: row.value_label,
    previous: row.old_value,
    current: row.new_value,
    source: row.source,
    source_visit_record_id: row.source_visit_record_id,
    change_reason: row.change_reason,
    importance: row.importance,
    confirmed_by: row.confirmed_by,
    confirmed_by_name: row.confirmed_by ? (nameMap.get(row.confirmed_by) ?? null) : null,
    confirmed_at: row.confirmed_at ? row.confirmed_at.toISOString() : null,
    valid_from: row.valid_from.toISOString(),
    valid_to: row.valid_to ? row.valid_to.toISOString() : null,
    is_current: row.is_current,
    updated_by: row.updated_by,
    updated_by_name: nameMap.get(row.updated_by) ?? null,
    created_at: row.created_at.toISOString(),
  }));
}
