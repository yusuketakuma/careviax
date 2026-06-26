import * as React from 'react';
import { format } from 'date-fns';
import { ja } from 'date-fns/locale';
import { StateBadge } from '@/components/ui/state-badge';
import type { StatusRole } from '@/lib/constants/status-tokens';
import { cn } from '@/lib/utils';

export type PatientSafetyTag = {
  /** 表示ラベル（例: ペニシリンアレルギー / 麻薬 / 抗凝固 / 腎機能低下）。 */
  label: string;
  /** 既定は hazard（橙の危険タグ）。アレルギーなど赤で示したい場合は blocked。 */
  role?: StatusRole;
};

export type PatientPinnedHeaderProps = {
  /** 患者氏名。最重要識別情報。 */
  name: string;
  /** フリガナ。 */
  kana?: string;
  /** 生年月日。age 未指定なら年齢を算出して併記する。 */
  birthDate?: Date | string | null;
  /** 年齢（birthDate から算出する代わりに直接渡す場合）。 */
  age?: number;
  /** 施設名・居宅などの所属。 */
  facility?: string;
  /**
   * 安全タグ（アレルギー/ハイリスク薬/麻薬/腎機能 等）。
   * 患者に害が及ぶ情報なので「常に全件表示」し +N で折りたたまない。
   */
  safetyTags?: PatientSafetyTag[];
  /** 次回訪問日など、識別の右側に添える補助情報。 */
  meta?: React.ReactNode;
  /** 上部に貼り付けて常時可視にする（既定 true）。スクロールしても識別が消えない。 */
  sticky?: boolean;
  /** 年齢算出の基準日（テスト用）。 */
  now?: Date;
  className?: string;
};

/**
 * 入力を「暦日」として正規化する。
 * `YYYY-MM-DD` のような日付のみ文字列は new Date() に通すと UTC 深夜と解釈され、
 * 負のオフセットの TZ では前日にずれる。これを避けるため年月日を直接ローカル日付として組む。
 * 時刻付き文字列（Z/offset 付き）や Date オブジェクトは、その瞬間のローカル暦日として扱う。
 */
function toCalendarDate(value: Date | string | null | undefined): Date | null {
  if (value == null || value === '') return null;
  if (typeof value === 'string') {
    const m = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return Number.isNaN(value.getTime()) ? null : value;
}

function formatBirth(birthDate: Date | string | null | undefined): string | null {
  const d = toCalendarDate(birthDate);
  if (!d) return null;
  return format(d, 'yyyy/MM/dd', { locale: ja });
}

function computeAge(
  birthDate: Date | string | null | undefined,
  age: number | undefined,
  now: Date,
): number | null {
  if (typeof age === 'number') return age;
  const d = toCalendarDate(birthDate);
  if (!d) return null;
  // 暦日（年/月/日）で満年齢を算出する。時刻・タイムゾーン・DST に依存させない。
  let years = now.getFullYear() - d.getFullYear();
  const beforeBirthday =
    now.getMonth() < d.getMonth() ||
    (now.getMonth() === d.getMonth() && now.getDate() < d.getDate());
  if (beforeBirthday) years -= 1;
  return years;
}

/**
 * 患者識別の Pinned ヘッダー。詳細・訪問・処方・報告書など患者文脈の画面で、
 * 氏名・生年月日・年齢・施設と「隠してはいけない安全タグ」を常時可視で固定する。
 * - 安全タグは折りたたまない（+N 禁止）。色だけに依存せず StateBadge がアイコン+テキストを伴う。
 * - 見出し要素はページ側が持つ前提（ここでは span。current の現在地表現を壊さない）。
 */
export function PatientPinnedHeader({
  name,
  kana,
  birthDate,
  age,
  facility,
  safetyTags,
  meta,
  sticky = true,
  now,
  className,
}: PatientPinnedHeaderProps) {
  const baseNow = now ?? new Date();
  const birth = formatBirth(birthDate);
  const resolvedAge = computeAge(birthDate, age, baseNow);

  return (
    <section
      aria-label="患者情報"
      data-sticky={sticky}
      className={cn(
        'flex flex-wrap items-center gap-x-4 gap-y-2 border-b bg-card px-4 py-3 ring-1 ring-foreground/10',
        sticky && 'sticky top-0 z-20',
        className,
      )}
    >
      <div className="min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="truncate font-heading text-base font-semibold">{name}</span>
          {kana ? <span className="truncate text-xs text-muted-foreground">{kana}</span> : null}
        </div>
        {birth || resolvedAge != null || facility ? (
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
            {birth ? <span className="tabular-nums">{birth}</span> : null}
            {resolvedAge != null ? <span className="tabular-nums">{resolvedAge}歳</span> : null}
            {facility ? <span className="truncate">{facility}</span> : null}
          </div>
        ) : null}
      </div>

      {safetyTags && safetyTags.length > 0 ? (
        <ul aria-label="安全情報" className="flex flex-wrap items-center gap-1.5">
          {safetyTags.map((tag, i) => (
            <li key={`${tag.label}-${i}`}>
              <StateBadge role={tag.role ?? 'hazard'}>{tag.label}</StateBadge>
            </li>
          ))}
        </ul>
      ) : null}

      {meta ? <div className="ml-auto text-xs text-muted-foreground">{meta}</div> : null}
    </section>
  );
}
