import { parseFrequencyToSlots } from './packaging-group';
import { type OutsideMedEvidenceKind } from './set-audit-constants';

/**
 * その他薬(セット外で持ち出す薬)の分類 SSOT。
 *
 * セット監査(set-audits)が carry-packet 証跡の期待値を導出するために使っていた
 * deriveOutsideMedEvidenceKind / isInternalRoute をここへ集約し、訪問準備・患者カード・
 * 報告など周辺画面でも「外用 / 頓服 / 注射 / 液剤 / 冷所」を同一語彙で表示できるようにする
 * (計画書 docs/dispensing-workbench-replacement-plan.md §11-7)。
 *
 * 既存列からの純導出のみ。スキーマ変更なし。raw enum/型は set-audit-constants.ts が SSOT。
 */

/** 分類に必要な処方明細の構造型(必要フィールドのみ・部分情報でも安全に評価する)。 */
export type OutsideMedClassifiableLine = {
  drug_name: string;
  dosage_form?: string | null;
  frequency: string;
  route?: string | null;
  packaging_instruction_tags?: string[] | null;
  packaging_instructions?: string | null;
  notes?: string | null;
  unit?: string | null;
};

/** 内服(経口)経路か。route 未指定は内服扱い(既定)。 */
export function isInternalRoute(route: string | null | undefined): boolean {
  return !route || route === 'internal' || route === 'oral' || route === '内服';
}

/**
 * 処方明細をその他薬分類へ写像する。内服でセット同梱できるものは null。
 * 経路・剤形・用法・包装タグ・備考の構造化+テキストから判定する。
 */
export function deriveOutsideMedEvidenceKind(
  line: OutsideMedClassifiableLine,
): OutsideMedEvidenceKind | null {
  const tags = line.packaging_instruction_tags ?? [];
  const detail = [
    line.drug_name,
    line.dosage_form ?? '',
    line.frequency,
    line.packaging_instructions ?? '',
    line.notes ?? '',
    line.unit ?? '',
    tags.join(' '),
  ].join(' ');

  if (!isInternalRoute(line.route)) {
    if (line.route === 'injection') return 'injection';
    if (/液|内用液|懸濁|mL|ml/.test(detail)) return 'liquid';
    return 'topical';
  }
  if (tags.includes('cold_storage') || /冷所|坐/.test(detail)) return 'cold';
  if (/注射|インスリン/.test(detail)) return 'injection';
  if (/外用|テープ|軟膏|点眼|点鼻/.test(detail)) return 'topical';
  if (/別容器|内用液|懸濁|液|mL|ml/.test(detail)) return 'liquid';
  if (parseFrequencyToSlots(line.frequency).includes('prn')) return 'prn';
  return null;
}

/** その他薬分類の日本語ラベル SSOT(UI/報告で同一語彙を使う)。 */
export const OUTSIDE_MED_EVIDENCE_KIND_LABELS: Record<OutsideMedEvidenceKind, string> = {
  prn: '頓服',
  topical: '外用',
  cold: '冷所',
  injection: '注射',
  liquid: '液剤',
  other: 'その他',
};
