import { Prisma } from '@prisma/client';
import { localDateKey, utcDateFromLocalKey } from '@/lib/utils/date-boundary';

/**
 * 患者項目の業務差分履歴(変更履歴 層b)+時点管理(層c)。
 *
 * 設計上の役割分担(二重実装の回避):
 * - AuditLog(層a) … DBトリガ ph_os_write_audit_log が「行単位の before/after JSON」を自動記録する監査ログ。
 * - PatientFieldRevision(本層) … 現場が見る「項目単位の差分・確認元・適用開始日・更新者」。
 *   差分の算出は呼び出し側(現在値更新サイト)で old→new が確定した時点で行い、本サービスはDBを再読込しない。
 *   ContactParty/Residence/PatientCondition は audit トリガ対象外のため、本層が唯一の変更履歴となる。
 */
export interface PatientFieldRevisionEntry {
  /** 項目カテゴリ: 現状 basic/residence/contacts/conditions/clinical（医療処置/麻薬は後続スライス） */
  category: string;
  /** 項目キー: 現状 基本情報/住所/contacts/conditions + 臨床(care_level/adl_level 等)。医療処置/麻薬は後続スライス */
  field_key: string;
  /** 表示名(例: 介護度) */
  field_label?: string | null;
  /** 変更前(JSON互換値。未設定は null/undefined) */
  old_value: unknown;
  /** 変更後(JSON互換値。クリアは null/undefined) */
  new_value: unknown;
  /** 整形済み表示値。未指定なら old/new から自動生成 */
  value_label?: string | null;
  /** 変更理由 */
  change_reason?: string | null;
  /** 重要度 */
  importance?: 'normal' | 'caution' | 'urgent';
  /** 確認者(別スタッフ) User ID */
  confirmed_by?: string | null;
  /** 確認日 */
  confirmed_at?: Date | null;
}

export interface WritePatientFieldRevisionsArgs {
  orgId: string;
  patientId: string;
  /** ケース紐付け項目(intake/home_visit_intake)用 */
  caseId?: string | null;
  /** 入力者(actor) User ID */
  actorId: string;
  /** 確認元/由来。既定: patient_detail_edit */
  source?: string;
  /** 反映導線(訪問記録→患者詳細)で使用 */
  sourceVisitRecordId?: string | null;
  /** 適用開始日。既定: 当日(ローカル日付のUTC深夜) */
  validFrom?: Date;
  entries: PatientFieldRevisionEntry[];
}

/** writePatientFieldRevisions が必要とする tx クライアントの最小契約(repo の Pick イディオムに準拠)。 */
export type PatientFieldRevisionTxClient = {
  patientFieldRevision: Pick<
    Prisma.TransactionClient['patientFieldRevision'],
    'updateMany' | 'create'
  >;
};

/**
 * 変更があった項目のみ履歴行を追記する。各 field_key について
 * 既存の現在行(is_current=true)を valid_to=適用日 でクローズし、新しい現在行を作成する
 * (PatientInsurance の close→create テンポラルパターンを汎用化)。
 * 値が等価のエントリ(old===new)はスキップする。
 *
 * @returns 実際に追記した履歴行数
 */
export async function writePatientFieldRevisions(
  tx: PatientFieldRevisionTxClient,
  args: WritePatientFieldRevisionsArgs
): Promise<number> {
  const changed = args.entries.filter((entry) => !isJsonEqual(entry.old_value, entry.new_value));
  if (changed.length === 0) return 0;

  const validFrom = args.validFrom ?? utcDateFromLocalKey(localDateKey());
  const source = args.source ?? 'patient_detail_edit';

  for (const entry of changed) {
    // 同一項目の現在行をクローズ(時点管理 層c)
    await tx.patientFieldRevision.updateMany({
      where: {
        org_id: args.orgId,
        patient_id: args.patientId,
        field_key: entry.field_key,
        is_current: true,
      },
      data: {
        is_current: false,
        valid_to: validFrom,
      },
    });

    const data: Prisma.PatientFieldRevisionUncheckedCreateInput = {
      org_id: args.orgId,
      patient_id: args.patientId,
      case_id: args.caseId ?? null,
      category: entry.category,
      field_key: entry.field_key,
      field_label: entry.field_label ?? null,
      // Json? 列へは null を Prisma.DbNull(=SQL NULL)へ変換して書き込む
      old_value: toJsonInput(entry.old_value),
      new_value: toJsonInput(entry.new_value),
      value_label: entry.value_label ?? formatRevisionValueLabel(entry.old_value, entry.new_value),
      source,
      source_visit_record_id: args.sourceVisitRecordId ?? null,
      confirmed_by: entry.confirmed_by ?? null,
      confirmed_at: entry.confirmed_at ?? null,
      valid_from: validFrom,
      is_current: true,
      change_reason: entry.change_reason ?? null,
      importance: entry.importance ?? 'normal',
      updated_by: args.actorId,
    };
    await tx.patientFieldRevision.create({ data });
  }

  return changed.length;
}

/** 「なし → あり」「(未設定) → 山田 太郎」のような現場向け表示ラベルを生成する。 */
export function formatRevisionValueLabel(oldValue: unknown, newValue: unknown): string {
  return `${describeRevisionValue(oldValue)} → ${describeRevisionValue(newValue)}`;
}

export function describeRevisionValue(value: unknown): string {
  if (value == null || value === '') return '(未設定)';
  if (typeof value === 'boolean') return value ? 'あり' : 'なし';
  if (Array.isArray(value)) return `${value.length}件`;
  if (typeof value === 'object') return '内容変更';
  return String(value);
}

/** Json? 列向けに null/undefined を Prisma.DbNull(=SQL NULL)へ変換する。 */
function toJsonInput(value: unknown): Prisma.InputJsonValue | typeof Prisma.DbNull {
  return value == null ? Prisma.DbNull : (value as Prisma.InputJsonValue);
}

/** 安定キー順での JSON 等価判定(配列/オブジェクトの差分検知用)。 */
export function isJsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return stableStringify(a) === stableStringify(b);
}

/**
 * 配列を要素内容(安定キー順 JSON)で決定的に並べ替える。
 * contacts/conditions のような順序非依存の集合で、UI の並び替えや
 * GET と保存経路の orderBy 差による「順序のみの偽差分」を防ぐために比較前に適用する。
 */
export function sortJsonArrayStable<T>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const ka = stableStringify(a);
    const kb = stableStringify(b);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value));
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value && typeof value === 'object') {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = sortKeysDeep((value as Record<string, unknown>)[key]);
        return acc;
      }, {});
  }
  return value;
}
