import type { TodayOpsRail } from '@/types/today-ops-rail';

/**
 * 13_master(マスター鮮度ハブ)BFF /api/admin/master-hub のペイロード。
 * マスター種別ごとに件数・最終更新・鮮度ステータス・現場語ナラティブ・遷移先を返す
 * (docs/design-gap-analysis-new.md 13_master)。
 */

/** 鮮度ステータス: 健全(緑)/ 確認中 N(橙)/ 期限接近(橙) */
export type MasterHubStatus = 'healthy' | 'checking' | 'due_soon';

export type MasterHubCard = {
  key: 'drugs' | 'professionals' | 'facilities' | 'staff' | 'vehicles';
  title: string;
  count: number;
  /** 件 / 名 / 台 */
  count_unit: string;
  last_updated_at: string | null;
  status: MasterHubStatus;
  /** 確認中 N の N(checking のときのみ) */
  status_count: number | null;
  /** 現場語の状況説明 1 行 */
  note: string;
  action_label: string;
  action_href: string;
};

export type MasterHubResponse = {
  generated_at: string;
  masters: MasterHubCard[];
  /** マスター系の設定変更監査ログ(今月)件数 */
  change_log_month_count: number;
  rail: TodayOpsRail;
};
