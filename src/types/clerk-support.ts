import { z } from 'zod';

/**
 * p0_25「事務サポート」ダッシュボード用 BFF レスポンス型。
 * 事務でできる作業の件数と着手リスト、薬剤師へ回す境界を 1 リクエストで返す。
 */

export const clerkSupportKpisSchema = z
  .object({
    /** 処方受付(取込済みで構造化が終わっていないサイクル) */
    intake_pending: z.number().int().nonnegative(),
    /** 送付先未設定(文書送付対象の連携先で FAX・メールとも未登録) */
    delivery_target_missing: z.number().int().nonnegative(),
    /** 日程確認(患者への連絡待ちの訪問候補) */
    schedule_confirmation: z.number().int().nonnegative(),
    /** 文書記録(下書きのままの報告書) */
    document_drafts: z.number().int().nonnegative(),
    /** 返信待ち(送付済みで返信が来ていない報告書) */
    reply_pending: z.number().int().nonnegative(),
    /** 薬剤師確認(未解決の workflow 例外) */
    pharmacist_review: z.number().int().nonnegative(),
  })
  .strict();
export type ClerkSupportKpis = z.infer<typeof clerkSupportKpisSchema>;

export const clerkSupportTaskSchema = z
  .object({
    id: z.string().min(1),
    /** 行の種別ラベル(処方受付 / 日程確認 など) */
    kind_label: z.string().min(1),
    patient_name: z.string().min(1),
    next_action: z.string().min(1),
    due_label: z.string().min(1).nullable(),
    href: z.string().min(1),
  })
  .strict();
export type ClerkSupportTask = z.infer<typeof clerkSupportTaskSchema>;

export const clerkSupportResponseSchema = z
  .object({
    generated_at: z.string().datetime(),
    kpis: clerkSupportKpisSchema,
    tasks: z.array(clerkSupportTaskSchema),
    /** 薬剤師に相談が必要(事務では判断しない境界の掲示) */
    consult_items: z.array(z.string().min(1)),
  })
  .strict();
export type ClerkSupportResponse = z.infer<typeof clerkSupportResponseSchema>;
