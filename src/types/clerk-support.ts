/**
 * p0_25「事務サポート」ダッシュボード用 BFF レスポンス型。
 * 事務でできる作業の件数と着手リスト、薬剤師へ回す境界を 1 リクエストで返す。
 */

export type ClerkSupportKpis = {
  /** 処方受付(取込済みで構造化が終わっていないサイクル) */
  intake_pending: number;
  /** 送付先未設定(文書送付対象の連携先で FAX・メールとも未登録) */
  delivery_target_missing: number;
  /** 日程確認(患者への連絡待ちの訪問候補) */
  schedule_confirmation: number;
  /** 文書記録(下書きのままの報告書) */
  document_drafts: number;
  /** 返信待ち(送付済みで返信が来ていない報告書) */
  reply_pending: number;
  /** 薬剤師確認(未解決の workflow 例外) */
  pharmacist_review: number;
};

export type ClerkSupportTask = {
  id: string;
  /** 行の種別ラベル(処方受付 / 日程確認 など) */
  kind_label: string;
  patient_name: string;
  next_action: string;
  due_label: string | null;
  href: string;
};

export type ClerkSupportResponse = {
  generated_at: string;
  kpis: ClerkSupportKpis;
  tasks: ClerkSupportTask[];
  /** 薬剤師に相談が必要(事務では判断しない境界の掲示) */
  consult_items: string[];
};
