import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/client';
import { batchResolveNames } from '@/lib/utils/name-resolver';
import { describeRevisionValue } from '@/server/services/patient-field-revision';

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

export interface PatientFieldRevisionListMeta {
  total_count: number;
  visible_count: number;
  hidden_count: number;
  truncated: boolean;
  count_basis: 'patient_field_revisions';
  filters_applied: {
    category: string | null;
  };
  /** Legacy alias for the database selection order. */
  sort_basis: 'created_at_desc';
  selection_basis: 'latest_created_at_desc_id_desc';
  presentation_order: 'created_at_asc_id_asc';
  limit: number;
}

export interface PatientFieldRevisionListPage {
  data: PatientFieldRevisionListItem[];
  meta: PatientFieldRevisionListMeta;
}

export interface PatientFieldRevisionMetadataItem {
  id: string;
  category: string;
  field_key: string;
  field_label: string | null;
  source: string;
  confirmed_by_name: string | null;
  confirmed_at: string | null;
  is_current: boolean;
  updated_by_name: string | null;
  created_at: string;
}

type RevisionRow = Awaited<ReturnType<typeof prisma.patientFieldRevision.findMany>>[number];
type RevisionMetadataRow = {
  id: string;
  category: string;
  field_key: string;
  field_label: string | null;
  source: string;
  confirmed_by: string | null;
  confirmed_at: Date | null;
  is_current: boolean;
  updated_by: string;
  created_at: Date;
};

// external_viewer / 未知ロール向けの fail-closed projection。低感度の定型値だけを許可し、
// 病名/アレルギー/患者メモ/連絡先/住所等は API 応答境界で presence のみに落とす。
const RAW_VALUE_ALLOWED_FIELD_KEYS = new Set([
  'care_level',
  'adl_level',
  'dementia_level',
  'swallowing_route',
  'infection_isolation',
  'billing_support_flag',
  'gender',
]);
// 追加/解除/変更の判定(値の有無)だけに使う非PHIプレースホルダ。UI には表示されない。
const MASKED_PRESENCE = '〔記録あり〕';
const UNRESOLVED_REFERENCE_LABEL = '参照先不明';

const USER_REFERENCE_FIELD_KEYS = new Set([
  'primary_pharmacist_id',
  'backup_pharmacist_id',
  'primary_staff_id',
  'backup_staff_id',
]);
const FACILITY_REFERENCE_FIELD_KEYS = new Set(['facility_id']);
const FACILITY_UNIT_REFERENCE_FIELD_KEYS = new Set(['facility_unit_id']);
// building_id は Residence の後方互換用自由テキストであり、opaque ID ではない。
const FREE_TEXT_ID_FIELD_KEYS = new Set(['building_id']);

type RevisionReferenceLabels = {
  users: Map<string, string>;
  facilities: Map<string, string>;
  facilityUnits: Map<string, string>;
};

function canExposeRawRevisionValue(category: string, fieldKey: string): boolean {
  return category === 'clinical' || category === 'basic'
    ? RAW_VALUE_ALLOWED_FIELD_KEYS.has(fieldKey)
    : false;
}

// 生値を返さず、値の有無のみを保持する(変更種別バッジの算出を維持しつつ PHI を出さない)。
function maskPresence(value: Prisma.JsonValue | null): Prisma.JsonValue | null {
  return value == null || value === '' ? null : MASKED_PRESENCE;
}

function readReferenceId(value: Prisma.JsonValue | null): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function collectReferenceIds(rows: RevisionRow[], fieldKeys: Set<string>): string[] {
  return Array.from(
    new Set(
      rows
        .filter((row) => fieldKeys.has(row.field_key))
        .flatMap((row) => [readReferenceId(row.old_value), readReferenceId(row.new_value)])
        .filter((value): value is string => value !== null),
    ),
  );
}

function isOpaqueReferenceField(fieldKey: string): boolean {
  return fieldKey.endsWith('_id') && !FREE_TEXT_ID_FIELD_KEYS.has(fieldKey);
}

async function resolveRevisionReferenceLabels(
  db: DbClient,
  orgId: string,
  rows: RevisionRow[],
  actorIds: string[],
  exposeSensitiveValues: boolean,
): Promise<RevisionReferenceLabels> {
  const referencedUserIds = exposeSensitiveValues
    ? collectReferenceIds(rows, USER_REFERENCE_FIELD_KEYS)
    : [];
  const facilityIds = exposeSensitiveValues
    ? collectReferenceIds(rows, FACILITY_REFERENCE_FIELD_KEYS)
    : [];
  const facilityUnitIds = exposeSensitiveValues
    ? collectReferenceIds(rows, FACILITY_UNIT_REFERENCE_FIELD_KEYS)
    : [];
  const userIds = Array.from(new Set([...actorIds, ...referencedUserIds]));

  const [users, facilities, facilityUnits] = await Promise.all([
    batchResolveNames(db as typeof prisma, orgId, userIds),
    facilityIds.length > 0
      ? db.facility.findMany({
          where: { org_id: orgId, id: { in: facilityIds } },
          select: { id: true, name: true },
        })
      : Promise.resolve([]),
    facilityUnitIds.length > 0
      ? db.facilityUnit.findMany({
          where: { org_id: orgId, id: { in: facilityUnitIds } },
          select: { id: true, name: true },
        })
      : Promise.resolve([]),
  ]);

  return {
    users,
    facilities: new Map(facilities.map((facility) => [facility.id, facility.name])),
    facilityUnits: new Map(facilityUnits.map((unit) => [unit.id, unit.name])),
  };
}

function referenceLabelMap(
  fieldKey: string,
  labels: RevisionReferenceLabels,
): Map<string, string> | null {
  if (USER_REFERENCE_FIELD_KEYS.has(fieldKey)) return labels.users;
  if (FACILITY_REFERENCE_FIELD_KEYS.has(fieldKey)) return labels.facilities;
  if (FACILITY_UNIT_REFERENCE_FIELD_KEYS.has(fieldKey)) return labels.facilityUnits;
  return null;
}

function describeReferenceValue(
  fieldKey: string,
  value: Prisma.JsonValue | null,
  labels: RevisionReferenceLabels,
): string {
  const referenceId = readReferenceId(value);
  if (referenceId === null) return describeRevisionValue(value);
  return referenceLabelMap(fieldKey, labels)?.get(referenceId) ?? UNRESOLVED_REFERENCE_LABEL;
}

function buildRevisionValueLabel(row: RevisionRow, labels: RevisionReferenceLabels) {
  if (!isOpaqueReferenceField(row.field_key)) return row.value_label;

  const rawReferenceIds = [readReferenceId(row.old_value), readReferenceId(row.new_value)].filter(
    (value): value is string => value !== null,
  );
  if (
    row.value_label &&
    rawReferenceIds.every((referenceId) => !row.value_label?.includes(referenceId))
  ) {
    return row.value_label;
  }

  return `${describeReferenceValue(row.field_key, row.old_value, labels)} → ${describeReferenceValue(
    row.field_key,
    row.new_value,
    labels,
  )}`;
}

/** 行配列を表示用に整形し、更新者/確認者の User ID を氏名へ解決する(両 list で共通)。 */
async function shapeRevisionRows(
  db: DbClient,
  orgId: string,
  rows: RevisionRow[],
  exposeSensitiveValues: boolean,
): Promise<PatientFieldRevisionListItem[]> {
  const actorIds = Array.from(
    new Set(
      rows.flatMap((row) => [row.updated_by, row.confirmed_by]).filter((id): id is string => !!id),
    ),
  );
  const referenceLabels = await resolveRevisionReferenceLabels(
    db,
    orgId,
    rows,
    actorIds,
    exposeSensitiveValues,
  );
  const nameMap = referenceLabels.users;

  return rows.map((row) => {
    const exposeRaw =
      exposeSensitiveValues || canExposeRawRevisionValue(row.category, row.field_key);
    return {
      id: row.id,
      category: row.category,
      field_key: row.field_key,
      field_label: row.field_label,
      value_label: exposeRaw ? buildRevisionValueLabel(row, referenceLabels) : null,
      previous: exposeRaw ? row.old_value : maskPresence(row.old_value),
      current: exposeRaw ? row.new_value : maskPresence(row.new_value),
      source: row.source,
      source_visit_record_id: row.source_visit_record_id,
      change_reason: exposeSensitiveValues ? row.change_reason : null,
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
    };
  });
}

async function shapeRevisionMetadataRows(
  db: DbClient,
  orgId: string,
  rows: RevisionMetadataRow[],
): Promise<PatientFieldRevisionMetadataItem[]> {
  const actorIds = Array.from(
    new Set(
      rows.flatMap((row) => [row.updated_by, row.confirmed_by]).filter((id): id is string => !!id),
    ),
  );
  const nameMap = await batchResolveNames(db as typeof prisma, orgId, actorIds);

  return rows.map((row) => ({
    id: row.id,
    category: row.category,
    field_key: row.field_key,
    field_label: row.field_label,
    source: row.source,
    confirmed_by_name: row.confirmed_by ? (nameMap.get(row.confirmed_by) ?? null) : null,
    confirmed_at: row.confirmed_at ? row.confirmed_at.toISOString() : null,
    is_current: row.is_current,
    updated_by_name: nameMap.get(row.updated_by) ?? null,
    created_at: row.created_at.toISOString(),
  }));
}

interface ListArgs {
  orgId: string;
  patientId: string;
  category?: string;
  limit?: number;
  /** 既知の内部スタッフrouteだけが明示する。省略時はfail-closed projection。 */
  exposeSensitiveValues?: boolean;
}

function buildPatientFieldRevisionWhere(args: ListArgs): Prisma.PatientFieldRevisionWhereInput {
  return {
    org_id: args.orgId,
    patient_id: args.patientId,
    ...(args.category ? { category: args.category } : {}),
  };
}

function buildRevisionListMeta(args: {
  totalCount: number;
  visibleCount: number;
  category?: string;
  limit: number;
}): PatientFieldRevisionListMeta {
  const hiddenCount = Math.max(args.totalCount - args.visibleCount, 0);
  return {
    total_count: args.totalCount,
    visible_count: args.visibleCount,
    hidden_count: hiddenCount,
    truncated: hiddenCount > 0,
    count_basis: 'patient_field_revisions',
    filters_applied: { category: args.category ?? null },
    sort_basis: 'created_at_desc',
    selection_basis: 'latest_created_at_desc_id_desc',
    presentation_order: 'created_at_asc_id_asc',
    limit: args.limit,
  };
}

function presentRevisionWindowChronologically(rows: RevisionRow[]): RevisionRow[] {
  return [...rows].reverse();
}

/**
 * 患者項目の変更履歴(PatientFieldRevision)を新しい順で取得し、
 * 更新者/確認者の User ID を氏名へ解決した表示用リストを返す。
 * 項目メタ表示など、既存のnewest-first内部consumer向け(read 専用)。
 */
export async function listPatientFieldRevisions(
  db: DbClient,
  args: ListArgs,
): Promise<PatientFieldRevisionListItem[]> {
  const limit = args.limit ?? 50;
  const rows = await db.patientFieldRevision.findMany({
    where: buildPatientFieldRevisionWhere(args),
    orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
    take: limit,
  });

  return shapeRevisionRows(db, args.orgId, rows, args.exposeSensitiveValues === true);
}

/**
 * Timeline向けに最新bounded windowを選択し、そのwindowだけを過去から現在の順で返す。
 */
export async function listPatientFieldRevisionPage(
  db: DbClient,
  args: ListArgs,
): Promise<PatientFieldRevisionListPage> {
  const limit = args.limit ?? 50;
  const where = buildPatientFieldRevisionWhere(args);
  const [totalCount, rows] = await Promise.all([
    db.patientFieldRevision.count({ where }),
    db.patientFieldRevision.findMany({
      where,
      orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
      take: limit,
    }),
  ]);
  const data = await shapeRevisionRows(
    db,
    args.orgId,
    presentRevisionWindowChronologically(rows),
    args.exposeSensitiveValues === true,
  );

  return {
    data,
    meta: buildRevisionListMeta({
      totalCount,
      visibleCount: data.length,
      category: args.category,
      limit,
    }),
  };
}

/**
 * 患者正本の項目メタ表示向けに、変更前後の raw 値を読まずに最小メタだけを取得する。
 * foundation/カード表示では value_label/old_value/new_value/change_reason を不要とし、
 * PHI の in-process exposure を避ける。
 */
export async function listPatientFieldRevisionMetadata(
  db: DbClient,
  args: ListArgs,
): Promise<PatientFieldRevisionMetadataItem[]> {
  const rows = await db.patientFieldRevision.findMany({
    where: buildPatientFieldRevisionWhere(args),
    orderBy: [{ created_at: 'desc' }],
    take: args.limit ?? 50,
    select: {
      id: true,
      category: true,
      field_key: true,
      field_label: true,
      source: true,
      confirmed_by: true,
      confirmed_at: true,
      is_current: true,
      updated_by: true,
      created_at: true,
    },
  });

  return shapeRevisionMetadataRows(db, args.orgId, rows);
}

interface BySourceVisitRecordArgs {
  orgId: string;
  patientId: string;
  sourceVisitRecordId: string;
  limit?: number;
  /** 既知の内部スタッフrouteだけが明示する。省略時はfail-closed projection。 */
  exposeSensitiveValues?: boolean;
}

/**
 * 特定の訪問記録から患者詳細(正本)へ反映された項目変更を取得する(read 専用)。
 * ⑤ 反映導線の「訪問側」provenance: この訪問が何を反映したかを訪問記録詳細で示す。
 */
export async function listFieldRevisionsBySourceVisitRecord(
  db: DbClient,
  args: BySourceVisitRecordArgs,
): Promise<PatientFieldRevisionListItem[]> {
  const rows = await db.patientFieldRevision.findMany({
    where: {
      org_id: args.orgId,
      patient_id: args.patientId,
      source_visit_record_id: args.sourceVisitRecordId,
    },
    orderBy: [{ created_at: 'desc' }],
    take: args.limit ?? 100,
  });

  return shapeRevisionRows(db, args.orgId, rows, args.exposeSensitiveValues === true);
}
