import { cn } from '@/lib/utils';
import {
  getHandlingTagBadgeClass,
  getHandlingTagLabel,
} from '@/components/features/workspace/safety-board';

/**
 * 患者安全タグの共通バッジ（FEBRUSH A5）。
 * 旧: patients-board / visits-today が各自ローカル実装しており、同一タグ（アレルギー/嚥下）の
 * 配色が画面間で乖離していた（SSOT「画面間で同一データを別色にしない」違反）。ここで一本化する。
 * - 重大タグ（アレルギー等）= hazard トークン（危険タグ。SSOT: 隠さない・目立たせる）
 * - 注意属性（腎機能/嚥下）= confirm 系の淡いトーン（要注意の患者属性）
 * - それ以外（麻薬/冷所/感染隔離/手技 等の取扱タグ）= SafetyBoard の配色ヘルパへフォールバック
 */

/**
 * 重大安全タグ。表示上限（+N 折り畳み）に関わらず必ず表示する
 * （医療安全: 重大タグの埋没防止。SSOT「安全タグは +N の裏に隠さない」）。
 */
export const CRITICAL_SAFETY_TAGS = new Set(['allergy', 'narcotic']);

const CRITICAL_PATIENT_TAG_CLASS = 'border-tag-hazard/30 bg-tag-hazard/10 text-tag-hazard';
const ATTRIBUTE_PATIENT_TAG_CLASS = 'border-state-confirm/45 bg-state-confirm/15 text-foreground';

const PATIENT_SAFETY_TAGS: Record<string, { label: string; className: string }> = {
  allergy: { label: 'アレルギー', className: CRITICAL_PATIENT_TAG_CLASS },
  renal: { label: '腎機能', className: ATTRIBUTE_PATIENT_TAG_CLASS },
  swallowing: { label: '嚥下', className: ATTRIBUTE_PATIENT_TAG_CLASS },
};

const DEFAULT_SAFETY_TAG_DISPLAY_LIMIT = 3;

/**
 * 表示する安全タグを選ぶ。重大タグは常に含め、残り枠を非重大タグで埋める。
 * 元の並び順（safety_tags の順）は保持する。server 側 SAFETY_TAG_ORDER は
 * 麻薬→…→アレルギーの順のため、単純な slice(0, limit) だと末尾のアレルギーが
 * 折り畳まれ得る — それを防ぐのが本関数の存在理由。
 */
export function selectVisibleSafetyTags(
  safetyTags: string[],
  limit: number = DEFAULT_SAFETY_TAG_DISPLAY_LIMIT,
): { tags: string[]; hiddenCount: number } {
  const criticalCount = safetyTags.filter((tag) => CRITICAL_SAFETY_TAGS.has(tag)).length;
  const budget = Math.max(limit, criticalCount);
  const visible = new Set<string>();
  // まず重大タグを全て確保。
  for (const tag of safetyTags) {
    if (CRITICAL_SAFETY_TAGS.has(tag)) visible.add(tag);
  }
  // 残り枠を非重大タグで埋める。
  for (const tag of safetyTags) {
    if (visible.size >= budget) break;
    visible.add(tag);
  }
  const tags = safetyTags.filter((tag) => visible.has(tag));
  return { tags, hiddenCount: safetyTags.length - tags.length };
}

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
