import * as React from 'react';
import Link from 'next/link';
import { ChevronRight, ShieldAlert } from 'lucide-react';
import { differenceInCalendarDays, format } from 'date-fns';
import { ja } from 'date-fns/locale';
import {
  getHandlingTagBadgeClass,
  getHandlingTagLabel,
} from '@/components/features/workspace/safety-board';
import { cn } from '@/lib/utils';

export type PatientCareTeam = {
  /** 主担当薬剤師（解決済み氏名）。 */
  primaryPharmacist?: string | null;
  /** 副担当薬剤師。 */
  backupPharmacist?: string | null;
  /** 主担当スタッフ（事務等）。 */
  primaryStaff?: string | null;
  /** 副担当スタッフ。 */
  backupStaff?: string | null;
};

export type PatientHeaderSafety = {
  /** 例: セフェム系(2019) */
  allergy?: string | null;
  /** 例: eGFR 38(6/1) */
  renal?: string | null;
  /** 取扱タグ(narcotic / cold_storage / unit_dose 等 or 日本語表記)。 */
  handlingTags?: string[];
  /** 嚥下・投与経路。 */
  swallowing?: string | null;
  /** 自由文の注意。 */
  cautions?: string[];
};

export type PatientHeaderProps = {
  // --- identity ---
  name: string;
  kana?: string | null;
  /** 生年月日。age 未指定なら TZ 非依存の暦日で満年齢を算出する。 */
  birthDate?: string | Date | null;
  age?: number | null;
  genderLabel?: string | null;
  careLevelLabel?: string | null;
  homeStatusLabel?: string | null;
  /** 施設 / 自宅 + 居室など。 */
  residenceLabel?: string | null;
  /** 主/副の担当薬剤師・担当スタッフ（解決済みの氏名）。 */
  careTeam?: PatientCareTeam;

  // --- clinical context（日付は表示用に整形済みの文字列を渡す） ---
  /** 主病名。 */
  primaryDiagnosis?: string | null;
  /** 介入開始日。○日目はここから算出する。 */
  interventionStartDate?: string | Date | null;
  firstVisitLabel?: string | null;
  lastVisitLabel?: string | null;
  nextVisitLabel?: string | null;
  lastPrescriptionLabel?: string | null;
  nextPrescriptionLabel?: string | null;

  // --- safety（常時表示・折りたたまない） ---
  safety?: PatientHeaderSafety;
  safetyCheckHref?: string;

  /** main(overflow-y-auto) 上端に固定して常時可視にする（既定 true）。 */
  sticky?: boolean;
  /** 年齢・介入日数の基準日（テスト用）。 */
  now?: Date;
  className?: string;
};

/** YYYY-MM-DD 等の日付のみ文字列を UTC ではなくローカル暦日として解釈する（TZ で前日にずれない）。 */
function toCalendarDate(value: string | Date | null | undefined): Date | null {
  if (value == null || value === '') return null;
  if (typeof value === 'string') {
    const m = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return Number.isNaN(value.getTime()) ? null : value;
}

function computeAge(
  birthDate: string | Date | null | undefined,
  age: number | null | undefined,
  now: Date,
): number | null {
  if (typeof age === 'number') return age;
  const d = toCalendarDate(birthDate);
  if (!d) return null;
  let years = now.getFullYear() - d.getFullYear();
  const beforeBirthday =
    now.getMonth() < d.getMonth() ||
    (now.getMonth() === d.getMonth() && now.getDate() < d.getDate());
  if (beforeBirthday) years -= 1;
  return years;
}

/** 「主 X / 副 Y」形式の担当表記。どちらも無ければ null。 */
function assignmentLabel(
  primary: string | null | undefined,
  backup: string | null | undefined,
): string | null {
  const parts: string[] = [];
  if (primary) parts.push(`主 ${primary}`);
  if (backup) parts.push(`副 ${backup}`);
  return parts.length > 0 ? parts.join(' / ') : null;
}

/** 介入開始日からの経過（○日目）。当日=1日目。 */
function interventionLabel(
  start: string | Date | null | undefined,
  now: Date,
): { dayCount: string; startLabel: string } | null {
  const d = toCalendarDate(start);
  if (!d) return null;
  const days = differenceInCalendarDays(now, d) + 1;
  if (days < 1) return null;
  return { dayCount: `${days}日目`, startLabel: format(d, 'yyyy/M/d', { locale: ja }) };
}

/** 「ラベル: 値」の小さな縦組みセル。値が無ければ何も描画しない。 */
function Field({
  label,
  value,
  emphasis,
}: {
  label: string;
  value: React.ReactNode;
  emphasis?: boolean;
}) {
  if (value == null || value === '') return null;
  return (
    <div className="min-w-0">
      <dt className="text-[11px] leading-tight text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          'mt-0.5 truncate text-xs leading-snug font-medium tabular-nums',
          emphasis ? 'font-semibold text-state-blocked' : 'text-foreground',
        )}
      >
        {value}
      </dd>
    </div>
  );
}

/**
 * 患者関連の全ページで共通利用する患者ヘッダー。
 * 情報量が多いため 3 層に圧縮して配置する:
 *   1) identity: 氏名・カナ・年齢/性別・要介護度・在宅状態・担当薬剤師
 *   2) clinical: 主病名・施設/居室・介入○日目・前回/次回処方・前回/次回訪問（密なラベル:値グリッド）
 *   3) safety:  アレルギー(赤強調)・取扱タグ・腎機能・嚥下・注意（折りたたまず常時表示）
 * - sticky で main スクロール上端に固定し、識別と安全情報を常に fold 内に保つ。
 * - 年齢/介入日数は暦日算出で TZ 非依存。状態色は 6 軸トークン、取扱タグは共通ヘルパで全画面統一。
 * - 全項目 optional。供給されない項目は描画しない（false-empty 回避）。
 */
export function PatientHeader({
  name,
  kana,
  birthDate,
  age,
  genderLabel,
  careLevelLabel,
  homeStatusLabel,
  residenceLabel,
  careTeam,
  primaryDiagnosis,
  interventionStartDate,
  firstVisitLabel,
  lastVisitLabel,
  nextVisitLabel,
  lastPrescriptionLabel,
  nextPrescriptionLabel,
  safety,
  safetyCheckHref,
  sticky = true,
  now,
  className,
}: PatientHeaderProps) {
  const baseNow = now ?? new Date();
  const resolvedAge = computeAge(birthDate, age, baseNow);
  const intervention = interventionLabel(interventionStartDate, baseNow);

  const ageGender = [resolvedAge != null ? `${resolvedAge}歳` : null, genderLabel]
    .filter(Boolean)
    .join('・');

  // clinical tier の各値を先に解決し、1 つも無ければ tier ごと描画しない（空帯=false-empty を出さない）。
  const interventionValue = intervention
    ? `${intervention.dayCount}（${intervention.startLabel}〜）`
    : null;
  const pharmacistValue = assignmentLabel(careTeam?.primaryPharmacist, careTeam?.backupPharmacist);
  const staffValue = assignmentLabel(careTeam?.primaryStaff, careTeam?.backupStaff);
  const prescriptionValue =
    lastPrescriptionLabel || nextPrescriptionLabel
      ? `${lastPrescriptionLabel ?? '—'} → ${nextPrescriptionLabel ?? '—'}`
      : null;
  const visitValue =
    lastVisitLabel || nextVisitLabel ? `${lastVisitLabel ?? '—'} → ${nextVisitLabel ?? '—'}` : null;
  const hasClinical = Boolean(
    primaryDiagnosis ||
    residenceLabel ||
    pharmacistValue ||
    staffValue ||
    interventionValue ||
    prescriptionValue ||
    visitValue ||
    firstVisitLabel,
  );

  const handlingTags = safety?.handlingTags ?? [];
  const cautionItems = (safety?.cautions ?? []).filter((c) => c.trim().length > 0);
  const hasSafety =
    Boolean(safety?.allergy || safety?.renal || safety?.swallowing) ||
    handlingTags.length > 0 ||
    cautionItems.length > 0;

  return (
    <section
      data-testid="patient-header"
      data-sticky={sticky}
      aria-label="患者情報"
      className={cn(
        'rounded-lg border bg-card ring-1 ring-foreground/10',
        sticky && 'sticky top-0 z-20',
        className,
      )}
    >
      {/* Tier 1: identity */}
      <div
        data-testid="patient-header-identity"
        className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 pt-3 pb-2"
      >
        <span className="font-heading text-lg leading-tight font-bold">{name} 様</span>
        {kana ? <span className="truncate text-xs text-muted-foreground">{kana}</span> : null}
        {ageGender ? (
          <span className="text-sm tabular-nums text-muted-foreground">{ageGender}</span>
        ) : null}
        {careLevelLabel ? (
          <span className="inline-flex items-center rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] font-medium text-foreground">
            {careLevelLabel}
          </span>
        ) : null}
        {homeStatusLabel ? (
          <span className="inline-flex items-center rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
            {homeStatusLabel}
          </span>
        ) : null}
      </div>

      {/* Tier 2: clinical context（密なラベル:値グリッド）。1 つも値が無ければ tier ごと出さない。 */}
      {hasClinical ? (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 border-t border-border/60 px-4 py-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
          <Field label="主病名" value={primaryDiagnosis} />
          <Field label="施設・居室" value={residenceLabel} />
          <Field label="担当薬剤師" value={pharmacistValue} />
          <Field label="担当スタッフ" value={staffValue} />
          <Field label="介入" value={interventionValue} />
          <Field label="処方 前回→次回" value={prescriptionValue} />
          <Field label="訪問 前回→次回" value={visitValue} />
          <Field label="初回訪問" value={firstVisitLabel} />
        </dl>
      ) : null}

      {/* Tier 3: safety（常時表示・折りたたまない） */}
      {hasSafety ? (
        <div
          data-testid="patient-header-safety"
          className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-tag-hazard/30 bg-tag-hazard/5 px-4 py-2"
        >
          <span className="inline-flex items-center gap-1 text-[11px] font-bold text-tag-hazard">
            <ShieldAlert aria-hidden className="size-3.5" />
            安全
          </span>
          {safety?.allergy ? (
            <span className="text-xs">
              <span className="text-muted-foreground">アレルギー </span>
              <span className="font-semibold text-state-blocked">{safety.allergy}</span>
            </span>
          ) : null}
          {handlingTags.length > 0 ? (
            <span
              className="flex flex-wrap items-center gap-1"
              data-testid="patient-header-handling"
            >
              {handlingTags.map((tag) => (
                <span
                  key={tag}
                  className={cn(
                    'inline-flex items-center rounded-full border px-2 py-0.5 text-[11px]',
                    getHandlingTagBadgeClass(tag),
                  )}
                >
                  {getHandlingTagLabel(tag)}
                </span>
              ))}
            </span>
          ) : null}
          {safety?.renal ? (
            <span className="text-xs">
              <span className="text-muted-foreground">腎機能 </span>
              <span className="font-medium text-foreground tabular-nums">{safety.renal}</span>
            </span>
          ) : null}
          {safety?.swallowing ? (
            <span className="text-xs">
              <span className="text-muted-foreground">嚥下 </span>
              <span className="font-medium text-foreground">{safety.swallowing}</span>
            </span>
          ) : null}
          {cautionItems.length > 0 ? (
            <span className="text-xs">
              <span className="text-muted-foreground">注意 </span>
              <span className="font-medium text-foreground">{cautionItems.join(' / ')}</span>
            </span>
          ) : null}
          {safetyCheckHref ? (
            <Link
              href={safetyCheckHref}
              data-testid="patient-header-safety-check-link"
              className="ml-auto inline-flex min-h-11 items-center gap-1 self-center rounded-md px-2 text-xs font-medium text-tag-hazard underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              薬の安全チェック
              <ChevronRight aria-hidden className="size-3.5" />
            </Link>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
