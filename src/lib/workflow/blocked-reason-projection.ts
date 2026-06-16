/**
 * 「止まっている理由(BlockedReason)」projection の単一の真実源(SSOT)。
 *
 * WorkflowException.exception_type → 表示カテゴリ / 個別アクション(ラベル・遷移先)の
 * 対応表と、open な WorkflowException 群から BlockedReason 配列を組み立てるヘルパーを集約する。
 *
 * これまで dashboard/cockpit・patients/board・visits/today-preparation の各 BFF に
 * インラインでコピーされ、互いに乖離(divergence)していたものを統合した。
 * - 各ルートの外部レスポンス形状は不変(純粋な内部リファクタ)。
 * - category は常に string を返す(CockpitBlockedReason.category の `string | null` とも互換)。
 */

export type BlockedReasonPresentation = {
  category: string;
  actionLabel: string;
  actionHref: string;
};

/**
 * WorkflowException.exception_type → 止まっている理由のカテゴリ/個別アクション。
 *
 * 3 ルートの乖離を統合した版。最も豊富/最新のバリアントを採用している。
 * 例: family_consent_pending の遷移先は 3 ルート中 2 ルートが採用し、より具体的な
 * /communications/requests を正とする。
 */
const EXCEPTION_PRESENTATIONS: Record<string, BlockedReasonPresentation> = {
  // 患者
  consent_revoked: { category: '患者', actionLabel: '再連絡する →', actionHref: '/patients' },
  missing_visit_consent: { category: '患者', actionLabel: '再連絡する →', actionHref: '/patients' },
  family_consent_pending: {
    category: '患者',
    actionLabel: '再連絡する →',
    actionHref: '/communications/requests',
  },
  no_show: { category: '患者', actionLabel: '再連絡する →', actionHref: '/patients' },
  hospitalized: { category: '患者', actionLabel: '状況を見る →', actionHref: '/patients' },
  medication_gap: { category: '患者', actionLabel: '状況を見る →', actionHref: '/patients' },
  // 事務
  delivery_target_confirmation: {
    category: '事務',
    actionLabel: '状況を見る →',
    actionHref: '/admin/contact-profiles',
  },
  // 医療機関
  awaiting_reply: {
    category: '医療機関',
    actionLabel: '状況を見る →',
    actionHref: '/communications/requests',
  },
  prescription_structuring_block: {
    category: '医療機関',
    actionLabel: '状況を見る →',
    actionHref: '/prescriptions',
  },
  reduction_prohibited_drug: {
    category: '医療機関',
    actionLabel: '状況を見る →',
    actionHref: '/workflow',
  },
  outpatient_injection_eligibility_block: {
    category: '医療機関',
    actionLabel: '状況を見る →',
    actionHref: '/workflow',
  },
  // 調剤
  dispense_audit_rejected: {
    category: '調剤',
    actionLabel: '状況を見る →',
    actionHref: '/dispense',
  },
  partial_dispense: { category: '調剤', actionLabel: '状況を見る →', actionHref: '/dispense' },
  set_audit_rejected: {
    category: '調剤',
    actionLabel: '状況を見る →',
    actionHref: '/medication-sets',
  },
};

/** 未知の exception_type のフォールバック(全ルート共通)。 */
const EXCEPTION_PRESENTATION_FALLBACK: BlockedReasonPresentation = {
  category: '事務',
  actionLabel: '状況を見る →',
  actionHref: '/workflow',
};

/**
 * exception_type を表示用 presentation(カテゴリ/アクション)へ解決する。
 * 未知のタイプはフォールバック(事務 / 状況を見る → / /workflow)を返す。
 */
export function resolveBlockedReasonPresentation(exceptionType: string): BlockedReasonPresentation {
  return EXCEPTION_PRESENTATIONS[exceptionType] ?? EXCEPTION_PRESENTATION_FALLBACK;
}

/** buildBlockedReasons が要求する open WorkflowException の最小形。 */
export type BlockedReasonSource = {
  id: string;
  exception_type: string;
  description: string;
  severity: string;
  created_at: Date;
};

/** 組み立てられた BlockedReason 1 件。各ルートの BlockedReason 型と構造的に互換。 */
export type BlockedReason = {
  id: string;
  label: string;
  severity: 'critical' | 'warning';
  category: string;
  age_minutes: number;
  action_label: string;
  action_href: string;
};

/**
 * open な WorkflowException 群から BlockedReason 配列を組み立てる。
 *
 * @param exceptions open な WorkflowException(id / exception_type / description / severity / created_at)
 * @param now 経過分(age_minutes)算出の基準時刻
 */
export function buildBlockedReasons(exceptions: BlockedReasonSource[], now: Date): BlockedReason[] {
  const nowMs = now.getTime();
  return exceptions.map((exception) => {
    const presentation = resolveBlockedReasonPresentation(exception.exception_type);
    return {
      id: exception.id,
      label: exception.description,
      severity: exception.severity === 'critical' ? 'critical' : 'warning',
      category: presentation.category,
      age_minutes: Math.max(0, Math.floor((nowMs - exception.created_at.getTime()) / 60_000)),
      action_label: presentation.actionLabel,
      action_href: presentation.actionHref,
    };
  });
}
