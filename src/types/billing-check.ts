import type { TodayOpsRail } from '@/types/today-ops-rail';

/**
 * 11_billing(算定チェック)BFF /api/billing-evidence/check のペイロード。
 * 「自動で大半は合格、人が見るのは疑義だけ」を 3 KPI + 疑義テーブルで返す
 * (docs/design-gap-analysis-new.md 11_billing)。
 */

export type BillingCheckMonth = 'current' | 'previous';

export type BillingCheckReviewRow = {
  id: string;
  /** 表示用の患者ラベル(例: 新規 鈴木 様 / 吉田 進 様(入院中)) */
  patient_label: string;
  patient_href: string | null;
  billing_name: string;
  /** 人が判断する事実だけを書く「確認すること」 */
  confirm_text: string;
  /** 根拠バッジ(例: 告示第69号 / 算定要件)。クリックで該当根拠へ飛ぶ */
  evidence_label: string;
  evidence_href: string;
  /** 戻り先アクション(例: → 訪問へ / 病院へ確認) */
  action_label: string;
  action_href: string;
};

export type BillingCheckResponse = {
  generated_at: string;
  month: BillingCheckMonth;
  /** 例: 2026年6月分 */
  month_label: string;
  /** 例: 6月分 */
  month_short_label: string;
  /** 自動チェック合格(claimable な根拠)件数 */
  passed_count: number;
  /** 疑義(人の確認待ち候補)件数 */
  review_count: number;
  /** 本日訪問の算定候補(訪問完了後に確定)件数 */
  today_pending_count: number;
  review_rows: BillingCheckReviewRow[];
  records: {
    /** 算定ルール版(例: 令和8年改定) */
    rule_revision_label: string;
    /** 返戻として除外された候補の件数 */
    rejection_count: number;
    /** 摘要欄テンプレの種類数 */
    summary_template_kind_count: number;
  };
  rail: TodayOpsRail;
};
