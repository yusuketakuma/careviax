/**
 * F-009 グローバル検索コマンドパレットのカテゴリレジストリ(MVP)。
 *
 * パレットは text 検索の 6 カテゴリのみを対象とする
 * (facilities / medicationDeadline は /search ページ専用機能のため除外)。
 *
 * 各カテゴリは「どの権限が必要か(no-fetch ゲート)」「org スコープか」
 * 「どの URL を叩くか」「生レスポンスの zod スキーマ(fail-closed)」
 * 「正規化(items 抽出)」「結果行 build」を自己完結で持つ。
 *
 * スキーマは API が `NextResponse.json(data)` で返す生の形(= `{ data: [...] }`)
 * を検証する。`{data}` 自動エンベロープ前提ではない。余分なキーは zod が strip する。
 */

import { z } from 'zod';
import type { PermissionKey } from '@/lib/auth/permission-matrix';
import {
  type SearchCategory,
  type SearchResultRow,
  SEARCH_CATEGORY_LABELS,
  buildPatientResult,
  buildScheduleProposalResult,
  buildPrescriptionResult,
  buildDrugResult,
  buildReportResult,
  buildContactResult,
} from '@/lib/search/result-builders';

/** パレット MVP が扱う text カテゴリ(facilities / medicationDeadline は除外)。 */
export type PaletteCategoryId = Extract<
  SearchCategory,
  'patient' | 'proposal' | 'prescription' | 'drug' | 'report' | 'contact'
>;

export type PaletteCategory = {
  id: PaletteCategoryId;
  label: string;
  /** null = 認証のみで可(= drug)。それ以外は hasPermission で判定。 */
  requiredPermission: PermissionKey | null;
  /** org スコープか。true のとき orgId 不在では fetch しない。 */
  orgScoped: boolean;
  /** クエリから URL を組み立てる(limit=8, q は encodeURIComponent)。 */
  endpoint: (query: string) => string;
  /** 生レスポンス(NextResponse.json(data))の fail-closed スキーマ。 */
  schema: { safeParse(value: unknown): { success: true; data: unknown } | { success: false } };
  /** parse 済みデータから検索対象 items を抽出。 */
  normalize: (parsed: unknown) => unknown[];
  /** item から結果行を構築。 */
  build: (item: unknown) => SearchResultRow;
  /** API が q を無視する等で client filter が必要なベストエフォート。 */
  bestEffort?: boolean;
  /** ベストエフォート時の UI/aria 補足ラベル。 */
  bestEffortNote?: string;
  /**
   * F-010A(backend の bounded/最小投影 server search)landing までパレットから一時除外する。
   * 現バックエンドは prescription が q を無視して患者名込みの最新行を返し、contact が limit なしで
   * phone/email/fax 等を spread するため、データ最小化(§9 系)の観点で palette には載せない。
   * F-010A 完了後に min 投影へ合わせて deferred を外す。
   */
  deferred?: boolean;
};

/**
 * パレットが各カテゴリ API に要求する最大件数。
 * endpoint の `limit` と schema の `data` 配列上限を**この 1 定数で同期**させる(SSOT)。
 * backend が limit を無視して上限超の配列を返した場合、schema.max が safeParse を失敗させ、
 * fetchCategory の fail-closed 経路で当該カテゴリを failed(rows=0)化する(成功扱いの暴露を防ぐ)。
 */
export const PALETTE_RESULT_LIMIT = 8;

const q8 = (query: string) => `q=${encodeURIComponent(query)}&limit=${PALETTE_RESULT_LIMIT}`;

// ---------------------------------------------------------------------------
// 生レスポンススキーマ(data 配列必須・必須フィールド欠落は reject)
// data 配列は PALETTE_RESULT_LIMIT 件まで。超過は fail-closed(safeParse 失敗 → failed)。
// ---------------------------------------------------------------------------

const patientSchema = z.object({
  data: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        name_kana: z.string().nullish(),
        conditions: z
          .array(z.object({ name: z.string(), is_primary: z.boolean().optional() }))
          .optional(),
        visit_schedules: z.array(z.object({ scheduled_date: z.string() })).optional(),
      }),
    )
    .max(PALETTE_RESULT_LIMIT),
});

const proposalSchema = z.object({
  data: z
    .array(
      z.object({
        id: z.string(),
        proposal_status: z.string(),
        patient_contact_status: z.string().nullish(),
        proposed_date: z.string(),
        time_window_start: z.string().nullish(),
        time_window_end: z.string().nullish(),
        proposed_pharmacist: z.object({ name: z.string().nullish() }).nullish(),
        case_: z
          .object({
            patient: z.object({ id: z.string().nullish(), name: z.string().nullish() }).nullish(),
          })
          .nullish(),
      }),
    )
    .max(PALETTE_RESULT_LIMIT),
});

const prescriptionSchema = z.object({
  data: z
    .array(
      z.object({
        id: z.string(),
        prescribed_date: z.string().nullish(),
        prescriber_institution: z.object({ name: z.string().nullish() }).nullish(),
        cycle: z
          .object({
            overall_status: z.string().nullish(),
            case_: z
              .object({ patient: z.object({ name: z.string().nullish() }).nullish() })
              .nullish(),
          })
          .nullish(),
      }),
    )
    .max(PALETTE_RESULT_LIMIT),
});

const drugSchema = z.object({
  data: z
    .array(
      z.object({
        id: z.string(),
        drug_name: z.string(),
        generic_name: z.string().nullish(),
        therapeutic_category: z.string().nullish(),
        yj_code: z.string().nullish(),
      }),
    )
    .max(PALETTE_RESULT_LIMIT),
});

const reportSchema = z.object({
  data: z
    .array(
      z.object({
        id: z.string(),
        report_type: z.string(),
        status: z.string(),
        created_at: z.string(),
        patient_id: z.string().nullish(),
        // patient 名があれば report タイトルに前置する(任意)。
        patient: z.object({ name: z.string().nullish() }).nullish(),
      }),
    )
    .max(PALETTE_RESULT_LIMIT),
});

const contactSchema = z.object({
  data: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        subtitle: z.string().nullish(),
        kind: z.string().nullish(),
      }),
    )
    .max(PALETTE_RESULT_LIMIT),
});

type WithData = { data: unknown[] };
const dataItems = (parsed: unknown): unknown[] => (parsed as WithData).data;

// ---------------------------------------------------------------------------
// レジストリ(表示順 = この配列順)
// ---------------------------------------------------------------------------

export const PALETTE_CATEGORIES: PaletteCategory[] = [
  {
    id: 'patient',
    label: SEARCH_CATEGORY_LABELS.patient,
    requiredPermission: 'canVisit',
    orgScoped: true,
    // view=palette で F-012 の最小投影({id,name,name_kana})を消費する。
    // これを付けないと full list 分岐に当たり phone/住所/保険等の over-wide payload が
    // ブラウザへ届く(UI zod の strip は fetch 後＝転送は発生済)。bounded/minimal 契約を守る。
    endpoint: (query) => `/api/patients?view=palette&${q8(query)}`,
    schema: patientSchema,
    normalize: dataItems,
    build: (item) => buildPatientResult(item as Parameters<typeof buildPatientResult>[0]),
  },
  {
    id: 'proposal',
    label: SEARCH_CATEGORY_LABELS.proposal,
    requiredPermission: 'canVisit',
    orgScoped: true,
    // view=palette で F-012 の最小投影(patient{id,name}+pharmacist{name}のみ。
    // 住所/geo/site/vehicle/contact_logs は返さない)を消費する。
    endpoint: (query) => `/api/visit-schedule-proposals?view=palette&${q8(query)}`,
    schema: proposalSchema,
    normalize: dataItems,
    build: (item) =>
      buildScheduleProposalResult(item as Parameters<typeof buildScheduleProposalResult>[0]),
  },
  {
    id: 'prescription',
    label: SEARCH_CATEGORY_LABELS.prescription,
    requiredPermission: 'canVisit',
    orgScoped: true,
    // API は q を server 側で無視する(limit=8 で payload は bounded)。
    // 取得 <=8 件を client 側で patient 名/施設名 前方一致 filter → 決定的 cap する。
    endpoint: (query) => `/api/prescription-intakes?${q8(query)}`,
    schema: prescriptionSchema,
    normalize: dataItems,
    build: (item) => buildPrescriptionResult(item as Parameters<typeof buildPrescriptionResult>[0]),
    bestEffort: true,
    bestEffortNote: '暫定（部分一致）',
  },
  {
    id: 'drug',
    label: SEARCH_CATEGORY_LABELS.drug,
    requiredPermission: null,
    orgScoped: false,
    endpoint: (query) => `/api/drug-masters?${q8(query)}`,
    schema: drugSchema,
    normalize: dataItems,
    build: (item) => buildDrugResult(item as Parameters<typeof buildDrugResult>[0]),
  },
  {
    id: 'report',
    label: SEARCH_CATEGORY_LABELS.report,
    requiredPermission: 'canReport',
    orgScoped: true,
    // view=palette で F-012 の最小投影({id,patient_id,report_type,status,created_at,patient:{name}})を
    // 消費する。content/pdf_url/delivery_records(送付先名等)は返さない。
    endpoint: (query) => `/api/care-reports?view=palette&${q8(query)}`,
    schema: reportSchema,
    normalize: dataItems,
    build: (item) => {
      const report = item as Parameters<typeof buildReportResult>[0] & {
        patient?: { name?: string | null } | null;
      };
      return buildReportResult(report, report.patient?.name ?? null);
    },
  },
  {
    id: 'contact',
    label: SEARCH_CATEGORY_LABELS.contact,
    requiredPermission: 'canReport',
    orgScoped: true,
    // F-010A(721ce32d)の最小サマリ投影 endpoint(q + limit)を消費する。
    endpoint: (query) =>
      `/api/contact-profiles?q=${encodeURIComponent(query)}&limit=${PALETTE_RESULT_LIMIT}`,
    schema: contactSchema,
    normalize: dataItems,
    build: (item) => buildContactResult(item as Parameters<typeof buildContactResult>[0]),
  },
];

/** パレットで実際に有効(非 deferred)なカテゴリ。F-010A landing 後に prescription/contact が復帰する。 */
export const ACTIVE_PALETTE_CATEGORIES = PALETTE_CATEGORIES.filter((c) => !c.deferred);
