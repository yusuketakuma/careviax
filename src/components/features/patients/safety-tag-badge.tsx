import { cn } from '@/lib/utils';
import {
  getHandlingTagBadgeClass,
  getHandlingTagLabel,
} from '@/components/features/workspace/safety-board';
export { CRITICAL_SAFETY_TAGS, selectVisibleSafetyTags } from '@/lib/patient/safety-tags';

/**
 * 患者安全タグの共通バッジ（FEBRUSH A5）。
 * 旧: patients-board / visits-today が各自ローカル実装しており、同一タグ（アレルギー/嚥下）の
 * 配色が画面間で乖離していた（SSOT「画面間で同一データを別色にしない」違反）。ここで一本化する。
 * - 重大タグ（アレルギー等）= hazard トークン（危険タグ。SSOT: 隠さない・目立たせる）
 * - 注意属性（腎機能/嚥下）= confirm 系の淡いトーン（要注意の患者属性）
 * - それ以外（麻薬/冷所/感染隔離/手技 等の取扱タグ）= SafetyBoard の配色ヘルパへフォールバック
 */

const CRITICAL_PATIENT_TAG_CLASS = 'border-tag-hazard/30 bg-tag-hazard/10 text-tag-hazard';
const ATTRIBUTE_PATIENT_TAG_CLASS = 'border-state-confirm/45 bg-state-confirm/15 text-foreground';

const PATIENT_SAFETY_TAGS: Record<string, { label: string; className: string }> = {
  allergy: { label: 'アレルギー', className: CRITICAL_PATIENT_TAG_CLASS },
  renal: { label: '腎機能', className: ATTRIBUTE_PATIENT_TAG_CLASS },
  swallowing: { label: '嚥下', className: ATTRIBUTE_PATIENT_TAG_CLASS },
};

/** 単一の安全タグバッジ。患者属性タグは統一パレット、取扱タグは SafetyBoard 配色。 */
export function SafetyTagBadge({ tag }: { tag: string }) {
  const patientTag = PATIENT_SAFETY_TAGS[tag];
  const className = patientTag?.className ?? getHandlingTagBadgeClass(tag);
  const label = patientTag?.label ?? getHandlingTagLabel(tag);
  return (
    <span
      className={cn('inline-flex items-center rounded-full border px-2 py-0.5 text-xs', className)}
    >
      {label}
    </span>
  );
}
