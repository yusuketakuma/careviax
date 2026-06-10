'use client';

import { useState, useMemo, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { differenceInCalendarDays, format } from 'date-fns';
import { ja } from 'date-fns/locale';
import {
  FileText,
  Pill,
  Syringe,
  Droplets,
  Package,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  AlertTriangle,
  Plus,
  Minus,
  ArrowRight,
  Copy,
  Printer,
  Ban,
  Shield,
  CheckCircle2,
  ExternalLink,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card';
import { HelpPopover } from '@/components/ui/help-popover';
import { formatDateKey } from '@/lib/date-key';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { Loading } from '@/components/ui/loading';
import { toast } from 'sonner';

// ─── Types ──────────────────────────────────────────────────────────────────

type PrescriptionLine = {
  id: string;
  line_number: number;
  drug_name: string;
  drug_code: string | null;
  dosage_form: string | null;
  dose: string;
  frequency: string;
  days: number;
  quantity: number | null;
  unit: string | null;
  is_generic: boolean;
  packaging_instructions: string | null;
  notes: string | null;
  route: string | null;
  dispensing_method: string | null;
  start_date: string | null;
  end_date: string | null;
};

type PrescriptionIntake = {
  id: string;
  cycle_id: string;
  source_type: string;
  prescribed_date: string;
  prescriber_name: string | null;
  prescriber_institution: string | null;
  prescription_expiry_date: string | null;
  original_document_url: string | null;
  original_collected_at: string | null;
  original_collected_by: string | null;
  refill_remaining_count: number | null;
  refill_next_dispense_date: string | null;
  split_dispense_total: number | null;
  split_dispense_current: number | null;
  split_next_dispense_date: string | null;
  created_at: string;
  cycle: { overall_status: string };
  lines: PrescriptionLine[];
};

type PatientInfo = { id: string; name: string; name_kana: string };

type DrugMasterInfo = {
  yj_code: string;
  drug_name: string;
  dosage_form: string | null;
  drug_price: number | null;
  unit: string | null;
  is_generic: boolean;
  is_narcotic: boolean;
  is_psychotropic: boolean;
  is_high_risk: boolean;
  is_lasa_risk: boolean;
  tall_man_name: string | null;
  lasa_group_key: string | null;
  max_administration_days: number | null;
  therapeutic_category: string | null;
};

type ChangeType = 'added' | 'removed' | 'dose_changed' | 'frequency_changed' | 'unchanged' | 'do';

type RpGroup = {
  frequency: string;
  days: number;
  route: string;
  lines: PrescriptionLine[];
};

type PrescriptionOverviewCard = {
  label: string;
  value: string;
  description: string;
};

type PrescriptionChangeSummaryItem = {
  drugName: string;
  label: string;
  color: string;
  detail: string;
};

type DispensingOverviewItem = {
  drugName: string;
  routeLabel: string;
  note: string;
  hasWarning: boolean;
};

// ─── Constants ──────────────────────────────────────────────────────────────

const ROUTE_CONFIG: Record<string, { label: string; icon: typeof Pill; color: string }> = {
  internal: { label: '内服', icon: Pill, color: 'bg-blue-100 text-blue-800' },
  external: { label: '外用', icon: Droplets, color: 'bg-green-100 text-green-800' },
  injection: { label: '注射', icon: Syringe, color: 'bg-purple-100 text-purple-800' },
  other: { label: 'その他', icon: Pill, color: 'bg-gray-100 text-gray-600' },
};

const METHOD_CONFIG: Record<string, { label: string; color: string }> = {
  standard: { label: '通常', color: 'bg-gray-100 text-gray-700' },
  unit_dose: { label: '一包化', color: 'bg-amber-100 text-amber-800' },
  crushed: { label: '粉砕', color: 'bg-red-100 text-red-800' },
  other: { label: 'その他', color: 'bg-gray-100 text-gray-600' },
};

const SOURCE_LABELS: Record<string, string> = {
  paper: '紙処方箋',
  fax: 'FAX',
  e_prescription: '電子処方箋',
  facility_batch: '施設一括',
  refill: 'リフィル',
};

const STATUS_LABELS: Record<
  string,
  { label: string; variant: 'default' | 'secondary' | 'outline' | 'destructive' }
> = {
  intake_received: { label: '受付済', variant: 'outline' },
  structuring: { label: '構造化中', variant: 'outline' },
  inquiry_pending: { label: '疑義照会中', variant: 'secondary' },
  ready_to_dispense: { label: '調剤可', variant: 'default' },
  dispensing: { label: '調剤中', variant: 'default' },
  audit_pending: { label: '鑑査待ち', variant: 'secondary' },
  audited: { label: '鑑査済', variant: 'default' },
  setting: { label: 'セット中', variant: 'default' },
  set_audited: { label: 'セット済', variant: 'default' },
  visit_ready: { label: '訪問準備完了', variant: 'default' },
  visit_completed: { label: '訪問完了', variant: 'default' },
  reported: { label: '報告済', variant: 'outline' },
  on_hold: { label: '保留', variant: 'destructive' },
  cancelled: { label: '中止', variant: 'destructive' },
};

// 一包化不適応キーワード（OD錠, 徐放製剤, 貼付剤, 坐剤, 点眼, 吸入等）
const UNIT_DOSE_INCOMPATIBLE_RE =
  /OD錠|口腔内崩壊|徐放|SR|CR|LA|XR|貼付|テープ|パップ|坐剤|坐薬|点眼|点鼻|吸入|注射|軟膏|クリーム|ローション|ゲル|液剤|シロップ|ドライシロップ|カプセル/i;

// 粉砕不可キーワード（腸溶性, 徐放, コーティング製剤）
const CRUSHED_INCOMPATIBLE_RE =
  /腸溶|徐放|SR|CR|LA|XR|コーティング|フィルムコート|糖衣|カプセル|OD錠|口腔内崩壊/i;

// ─── Helpers ────────────────────────────────────────────────────────────────

function inferRoute(line: PrescriptionLine): string {
  if (line.route) return line.route;
  const form = (line.dosage_form ?? '').toLowerCase();
  const name = line.drug_name.toLowerCase();
  if (/注射|注入|点滴/.test(form) || /注射/.test(name)) return 'injection';
  if (/軟膏|クリーム|貼付|テープ|パップ|坐剤|坐薬|吸入|点眼|点鼻|噴霧|ローション|ゲル/.test(form))
    return 'external';
  return 'internal';
}

function inferMethod(line: PrescriptionLine): string | null {
  if (line.dispensing_method) return line.dispensing_method;
  const pkg = (line.packaging_instructions ?? '').toLowerCase();
  if (/一包化/.test(pkg)) return 'unit_dose';
  if (/粉砕/.test(pkg)) return 'crushed';
  return null;
}

function isUnitDoseIncompatible(line: PrescriptionLine): boolean {
  const target = `${line.drug_name} ${line.dosage_form ?? ''}`;
  return UNIT_DOSE_INCOMPATIBLE_RE.test(target);
}

function isCrushedIncompatible(line: PrescriptionLine): boolean {
  const target = `${line.drug_name} ${line.dosage_form ?? ''}`;
  return CRUSHED_INCOMPATIBLE_RE.test(target);
}

function computeEndDate(line: PrescriptionLine, prescribedDate: string): string | null {
  if (line.end_date) return line.end_date;
  const start = line.start_date ?? prescribedDate;
  if (!start || !line.days) return null;
  const d = new Date(start);
  d.setDate(d.getDate() + line.days - 1);
  return formatDateKey(d);
}

function fmtDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  return format(new Date(dateStr), 'yyyy/MM/dd', { locale: ja });
}

function methodLabel(method: string | null) {
  if (!method) return '通常';
  return METHOD_CONFIG[method]?.label ?? method;
}

function routeLabel(route: string | null) {
  if (!route) return ROUTE_CONFIG.other.label;
  return ROUTE_CONFIG[route]?.label ?? ROUTE_CONFIG.other.label;
}

/** Group lines by frequency+days+route into Rp groups (レセコン方式) */
function groupByFrequency(lines: PrescriptionLine[]): RpGroup[] {
  const map = new Map<string, RpGroup>();
  for (const line of lines) {
    const route = inferRoute(line);
    const key = `${line.frequency}|${line.days}|${route}`;
    const existing = map.get(key);
    if (existing) {
      existing.lines.push(line);
    } else {
      map.set(key, { frequency: line.frequency, days: line.days, route, lines: [line] });
    }
  }
  return Array.from(map.values());
}

/** Detect change type between prev and current prescription for a drug */
function detectChange(
  prevLines: PrescriptionLine[] | null,
  currentLine: PrescriptionLine,
): ChangeType {
  if (!prevLines) return 'added';
  const prev = prevLines.find(
    (p) =>
      p.drug_name === currentLine.drug_name ||
      (p.drug_code && p.drug_code === currentLine.drug_code),
  );
  if (!prev) return 'added';
  if (prev.dose !== currentLine.dose) return 'dose_changed';
  if (prev.frequency !== currentLine.frequency) return 'frequency_changed';
  return 'unchanged';
}

/** Check if entire intake is Do処方 (same as previous) */
function isDoPrescription(current: PrescriptionIntake, prev: PrescriptionIntake | null): boolean {
  if (!prev) return false;
  if (current.lines.length !== prev.lines.length) return false;
  const sortedCurr = [...current.lines].sort((a, b) => a.drug_name.localeCompare(b.drug_name));
  const sortedPrev = [...prev.lines].sort((a, b) => a.drug_name.localeCompare(b.drug_name));
  return sortedCurr.every((c, i) => {
    const p = sortedPrev[i];
    return (
      c.drug_name === p.drug_name &&
      c.dose === p.dose &&
      c.frequency === p.frequency &&
      c.days === p.days
    );
  });
}

function buildOverlapSet(allIntakes: PrescriptionIntake[]): Set<string> {
  const overlaps = new Set<string>();
  const periods: Array<{
    lineId: string;
    drugName: string;
    drugCode: string | null;
    start: number;
    end: number;
    intakeId: string;
  }> = [];

  for (const intake of allIntakes) {
    for (const line of intake.lines) {
      const startStr = line.start_date ?? intake.prescribed_date;
      const endStr = computeEndDate(line, intake.prescribed_date);
      if (!startStr || !endStr) continue;
      periods.push({
        lineId: line.id,
        drugName: line.drug_name,
        drugCode: line.drug_code,
        start: new Date(startStr).getTime(),
        end: new Date(endStr).getTime(),
        intakeId: intake.id,
      });
    }
  }

  for (let i = 0; i < periods.length; i++) {
    for (let j = i + 1; j < periods.length; j++) {
      const a = periods[i];
      const b = periods[j];
      if (a.intakeId === b.intakeId) continue;
      const sameDrug =
        a.drugName === b.drugName || (a.drugCode != null && a.drugCode === b.drugCode);
      if (!sameDrug) continue;
      if (a.start <= b.end && b.start <= a.end) {
        overlaps.add(a.lineId);
        overlaps.add(b.lineId);
      }
    }
  }

  return overlaps;
}

const CHANGE_BADGES: Record<
  ChangeType,
  { label: string; icon: typeof Plus; color: string } | null
> = {
  added: { label: '新規', icon: Plus, color: 'bg-green-100 text-green-800' },
  removed: { label: '中止', icon: Minus, color: 'bg-red-100 text-red-800' },
  dose_changed: { label: '用量変更', icon: ArrowRight, color: 'bg-orange-100 text-orange-800' },
  frequency_changed: {
    label: '用法変更',
    icon: ArrowRight,
    color: 'bg-orange-100 text-orange-800',
  },
  unchanged: null,
  do: null,
};

function buildOverviewCards(intakes: PrescriptionIntake[]): PrescriptionOverviewCard[] {
  const latest = intakes[0] ?? null;
  const uniquePrescribers = new Set(
    intakes.map((item) => item.prescriber_name).filter((value): value is string => Boolean(value)),
  );
  const latestLines = latest?.lines ?? [];
  const specialMethods = latestLines.filter((line) => {
    const method = inferMethod(line);
    return method === 'unit_dose' || method === 'crushed';
  }).length;
  const cautionCount = latestLines.filter((line) => {
    const method = inferMethod(line);
    return (
      (method === 'unit_dose' && isUnitDoseIncompatible(line)) ||
      (method === 'crushed' && isCrushedIncompatible(line)) ||
      Boolean(line.notes)
    );
  }).length;

  return [
    {
      label: '最新処方日',
      value: latest ? fmtDate(latest.prescribed_date) : '—',
      description: latest?.source_type
        ? (SOURCE_LABELS[latest.source_type] ?? latest.source_type)
        : '処方履歴なし',
    },
    {
      label: '最新処方の薬剤数',
      value: `${latestLines.length}剤`,
      description: '一番新しい処方に含まれる薬剤数です。',
    },
    {
      label: '処方医',
      value: `${uniquePrescribers.size}名`,
      description: latest?.prescriber_name ?? '未登録',
    },
    {
      label: '特別な調剤指示',
      value: `${specialMethods}件`,
      description: cautionCount > 0 ? `要確認 ${cautionCount}件` : '警告なし',
    },
  ];
}

function buildLatestChangeSummary(
  current: PrescriptionIntake | null,
  previous: PrescriptionIntake | null,
): PrescriptionChangeSummaryItem[] {
  if (!current) return [];
  const previousLines = previous?.lines ?? [];
  const items: PrescriptionChangeSummaryItem[] = [];

  for (const line of current.lines) {
    const change = detectChange(previous ? previousLines : null, line);
    if (change === 'unchanged') continue;
    const cfg = CHANGE_BADGES[change];
    items.push({
      drugName: line.drug_name,
      label: cfg?.label ?? '変更',
      color: cfg?.color ?? 'bg-slate-100 text-slate-700',
      detail:
        change === 'added'
          ? `${line.dose} / ${line.frequency}`
          : `${line.dose} / ${line.frequency} に更新`,
    });
  }

  for (const line of previousLines) {
    const exists = current.lines.some(
      (currentLine) =>
        currentLine.drug_name === line.drug_name ||
        (currentLine.drug_code && currentLine.drug_code === line.drug_code),
    );
    if (exists) continue;
    items.push({
      drugName: line.drug_name,
      label: '中止',
      color: 'bg-red-100 text-red-800',
      detail: `${line.dose} / ${line.frequency}`,
    });
  }

  return items.slice(0, 6);
}

function buildDispensingOverview(intake: PrescriptionIntake | null): DispensingOverviewItem[] {
  if (!intake) return [];

  return intake.lines
    .map((line) => {
      const method = inferMethod(line);
      const hasWarning =
        (method === 'unit_dose' && isUnitDoseIncompatible(line)) ||
        (method === 'crushed' && isCrushedIncompatible(line)) ||
        Boolean(line.notes);
      const noteParts = [
        `調剤: ${methodLabel(method)}`,
        line.packaging_instructions ? `包装: ${line.packaging_instructions}` : null,
        line.notes ? `備考: ${line.notes}` : null,
        `${line.days}日分`,
      ].filter((value): value is string => Boolean(value));

      return {
        drugName: line.drug_name,
        routeLabel: routeLabel(inferRoute(line)),
        note: noteParts.join(' / '),
        hasWarning,
      };
    })
    .sort((left, right) => Number(right.hasWarning) - Number(left.hasWarning))
    .slice(0, 8);
}

// ─── Line Row ───────────────────────────────────────────────────────────────

function DrugLineRow({
  line,
  prescribedDate,
  changeType,
  hasOverlap,
  masterInfo,
}: {
  line: PrescriptionLine;
  prescribedDate: string;
  changeType: ChangeType;
  hasOverlap: boolean;
  masterInfo?: DrugMasterInfo;
}) {
  const method = inferMethod(line);
  const methodCfg = method ? (METHOD_CONFIG[method] ?? null) : null;
  const startDate = line.start_date ?? prescribedDate;
  const endDate = computeEndDate(line, prescribedDate);
  const changeBadge = CHANGE_BADGES[changeType];
  const unitDoseWarn = method === 'unit_dose' && isUnitDoseIncompatible(line);
  const crushedWarn = method === 'crushed' && isCrushedIncompatible(line);
  const displayDrugName = masterInfo?.tall_man_name?.trim() || line.drug_name;
  const hasTallManName = displayDrugName !== line.drug_name;

  return (
    <div
      className={[
        'flex items-start gap-3 border-b border-border/30 px-4 py-2 last:border-0 transition-colors',
        changeType === 'added' ? 'bg-green-50/40' : '',
        changeType === 'dose_changed' || changeType === 'frequency_changed'
          ? 'bg-orange-50/40'
          : '',
        hasOverlap ? 'ring-1 ring-inset ring-red-300' : '',
      ].join(' ')}
    >
      {/* Drug info */}
      <div className="min-w-0 flex-1 space-y-0.5">
        {/* Name row */}
        <div className="flex flex-wrap items-baseline gap-1.5">
          <span className="font-medium text-foreground">{displayDrugName}</span>
          {hasTallManName && (
            <Badge
              variant="outline"
              className="h-4 border-amber-300 px-1 text-[10px] font-normal text-amber-800"
            >
              Tall Man
            </Badge>
          )}
          {line.is_generic && (
            <Badge
              variant="outline"
              className="h-4 px-1 text-[10px] font-normal text-blue-600 border-blue-300"
            >
              後発
            </Badge>
          )}
          {line.dosage_form && (
            <span className="text-xs text-muted-foreground">[{line.dosage_form}]</span>
          )}
          {masterInfo?.is_narcotic && (
            <span className="inline-flex items-center gap-0.5 rounded bg-red-100 px-1 py-0.5 text-[10px] font-bold text-red-700">
              <AlertTriangle className="size-2.5" aria-hidden="true" />
              麻薬
            </span>
          )}
          {masterInfo?.is_psychotropic && (
            <span className="inline-flex items-center gap-0.5 rounded bg-orange-100 px-1 py-0.5 text-[10px] font-bold text-orange-700">
              <Shield className="size-2.5" aria-hidden="true" />
              向精神
            </span>
          )}
          {masterInfo?.is_high_risk && (
            <span className="inline-flex items-center gap-0.5 rounded border border-red-300 bg-red-50 px-1 py-0.5 text-[10px] font-bold text-red-700">
              <AlertTriangle className="size-2.5" aria-hidden="true" />
              ハイリスク
            </span>
          )}
          {masterInfo?.is_lasa_risk && (
            <span className="inline-flex items-center gap-0.5 rounded border border-amber-300 bg-amber-50 px-1 py-0.5 text-[10px] font-bold text-amber-800">
              LASA
            </span>
          )}
          {masterInfo?.drug_price != null && (
            <span className="text-[10px] tabular-nums text-muted-foreground">
              ¥{Number(masterInfo.drug_price).toFixed(1)}
            </span>
          )}
          {changeBadge && (
            <span
              className={`inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-medium ${changeBadge.color}`}
            >
              <changeBadge.icon className="size-2.5" aria-hidden="true" />
              {changeBadge.label}
            </span>
          )}
        </div>
        {hasTallManName && (
          <p className="text-xs text-muted-foreground">通常表記: {line.drug_name}</p>
        )}
        {masterInfo?.lasa_group_key && (
          <p className="text-xs font-medium text-amber-800">
            類似薬剤名グループ: {masterInfo.lasa_group_key}
          </p>
        )}

        {/* Dose row */}
        <div className="flex flex-wrap items-center gap-x-3 text-sm">
          <span className="font-medium">{line.dose}</span>
          {line.quantity != null && line.unit && (
            <span className="tabular-nums text-muted-foreground">
              ({line.quantity}
              {line.unit})
            </span>
          )}
          {methodCfg && (
            <span
              className={`rounded px-1 py-0.5 text-[10px] font-medium leading-none ${methodCfg.color}`}
            >
              {methodCfg.label}
            </span>
          )}
        </div>

        {/* Period + warnings */}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
          <time dateTime={startDate ?? undefined}>{fmtDate(startDate)}</time>
          <span aria-hidden="true">〜</span>
          <time dateTime={endDate ?? undefined}>{fmtDate(endDate)}</time>
          <span className="tabular-nums">{line.days}日分</span>

          {line.packaging_instructions && (
            <span className="flex items-center gap-0.5">
              <Package className="size-3" aria-hidden="true" />
              {line.packaging_instructions}
            </span>
          )}

          {unitDoseWarn && (
            <span className="flex items-center gap-0.5 text-red-600 font-medium" role="alert">
              <Ban className="size-3" aria-hidden="true" />
              一包化不適
            </span>
          )}
          {crushedWarn && (
            <span className="flex items-center gap-0.5 text-red-600 font-medium" role="alert">
              <Ban className="size-3" aria-hidden="true" />
              粉砕不可
            </span>
          )}
          {hasOverlap && (
            <span className="flex items-center gap-0.5 text-red-600 font-medium" role="alert">
              <AlertTriangle className="size-3" aria-hidden="true" />
              期間重複
            </span>
          )}
          {line.notes && (
            <span className="flex items-center gap-0.5 text-amber-600">
              <AlertTriangle className="size-3" aria-hidden="true" />
              {line.notes}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Rp Group (用法グループ) ────────────────────────────────────────────────

function RpGroupBlock({
  group,
  rpIndex,
  prescribedDate,
  prevLines,
  overlapSet,
  masterMap,
}: {
  group: RpGroup;
  rpIndex: number;
  prescribedDate: string;
  prevLines: PrescriptionLine[] | null;
  overlapSet: Set<string>;
  masterMap: Record<string, DrugMasterInfo>;
}) {
  const routeCfg = ROUTE_CONFIG[group.route] ?? ROUTE_CONFIG.other;
  const RouteIcon = routeCfg.icon;

  return (
    <div className="border-b border-border/50 last:border-0">
      {/* Rp header: route icon + frequency + days */}
      <div className="flex items-center gap-2 bg-muted/20 px-4 py-1.5">
        <span
          className={`flex size-5 items-center justify-center rounded ${routeCfg.color}`}
          title={routeCfg.label}
        >
          <RouteIcon className="size-3" aria-hidden="true" />
        </span>
        <span className="text-xs font-semibold text-muted-foreground tabular-nums">
          Rp{rpIndex}
        </span>
        <span className="text-xs font-medium text-foreground">{group.frequency}</span>
        <span className="text-xs text-muted-foreground tabular-nums">{group.days}日分</span>
      </div>
      {/* Drug lines */}
      {group.lines.map((line) => (
        <DrugLineRow
          key={line.id}
          line={line}
          prescribedDate={prescribedDate}
          changeType={detectChange(prevLines, line)}
          hasOverlap={overlapSet.has(line.id)}
          masterInfo={line.drug_code ? masterMap[line.drug_code] : undefined}
        />
      ))}
    </div>
  );
}

// ─── Section (内服/外用/注射) ────────────────────────────────────────────────

function RouteSection({
  routeKey,
  groups,
  rpOffset,
  prescribedDate,
  prevLines,
  overlapSet,
  masterMap,
}: {
  routeKey: string;
  groups: RpGroup[];
  rpOffset: number;
  prescribedDate: string;
  prevLines: PrescriptionLine[] | null;
  overlapSet: Set<string>;
  masterMap: Record<string, DrugMasterInfo>;
}) {
  const cfg = ROUTE_CONFIG[routeKey] ?? ROUTE_CONFIG.other;
  const totalDrugs = groups.reduce((sum, g) => sum + g.lines.length, 0);
  const sectionColors: Record<string, string> = {
    internal: 'bg-blue-50/50 text-blue-700',
    external: 'bg-green-50/50 text-green-700',
    injection: 'bg-purple-50/50 text-purple-700',
    other: 'bg-gray-50/50 text-gray-700',
  };

  return (
    <section>
      <div className={`border-t px-4 py-1 ${sectionColors[routeKey] ?? sectionColors.other}`}>
        <span className="text-xs font-semibold">
          {cfg.label}（{totalDrugs}剤）
        </span>
      </div>
      {groups.map((group, gi) => (
        <RpGroupBlock
          key={`${group.frequency}-${group.days}-${gi}`}
          group={group}
          rpIndex={rpOffset + gi + 1}
          prescribedDate={prescribedDate}
          prevLines={prevLines}
          overlapSet={overlapSet}
          masterMap={masterMap}
        />
      ))}
    </section>
  );
}

// ─── Intake Card ────────────────────────────────────────────────────────────

function PrescriptionIntakeCard({
  intake,
  prevIntake,
  overlapSet,
  masterMap,
  onMarkOriginalCollected,
  isMarkingOriginalCollected,
}: {
  intake: PrescriptionIntake;
  prevIntake: PrescriptionIntake | null;
  overlapSet: Set<string>;
  masterMap: Record<string, DrugMasterInfo>;
  onMarkOriginalCollected: (intakeId: string) => void;
  isMarkingOriginalCollected: boolean;
}) {
  const [expanded, setExpanded] = useState(true);
  const statusCfg = STATUS_LABELS[intake.cycle.overall_status];
  const isDo = prevIntake ? isDoPrescription(intake, prevIntake) : false;
  const prevLines = prevIntake?.lines ?? null;
  const isFax = intake.source_type === 'fax';
  const originalCollected = Boolean(intake.original_collected_at);
  const faxOriginalOverdue =
    isFax &&
    !originalCollected &&
    differenceInCalendarDays(new Date(), new Date(intake.created_at)) >= 3;

  // Detect removed drugs (in prev but not in current)
  const removedDrugs = useMemo(() => {
    if (!prevLines) return [];
    return prevLines.filter(
      (p) =>
        !intake.lines.some(
          (c) => c.drug_name === p.drug_name || (c.drug_code && c.drug_code === p.drug_code),
        ),
    );
  }, [prevLines, intake.lines]);

  // Group by route → then by frequency
  const sections = useMemo(() => {
    const routeGroups: Record<string, RpGroup[]> = { internal: [], external: [], injection: [] };
    const allGroups = groupByFrequency(intake.lines);
    for (const group of allGroups) {
      const bucket = routeGroups[group.route] ?? (routeGroups.other = routeGroups.other ?? []);
      (routeGroups[group.route] ?? bucket).push(group);
    }
    return routeGroups;
  }, [intake.lines]);

  let rpCounter = 0;

  return (
    <Card className="overflow-hidden print:break-inside-avoid print:shadow-none print:border">
      <CardHeader
        className="cursor-pointer px-4 py-3 print:cursor-default"
        onClick={() => setExpanded(!expanded)}
        role="button"
        aria-expanded={expanded}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="print:hidden">
              {expanded ? (
                <ChevronDown className="size-4 text-muted-foreground" />
              ) : (
                <ChevronRight className="size-4 text-muted-foreground" />
              )}
            </span>
            <FileText className="size-4 text-muted-foreground" aria-hidden="true" />
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <time
                  dateTime={intake.prescribed_date}
                  className="text-sm font-semibold tabular-nums"
                >
                  {format(new Date(intake.prescribed_date), 'yyyy年M月d日', { locale: ja })}
                </time>
                <span className="text-xs text-muted-foreground">
                  {SOURCE_LABELS[intake.source_type] ?? intake.source_type}
                </span>
                {statusCfg && (
                  <Badge variant={statusCfg.variant} className="h-5 text-[10px]">
                    {statusCfg.label}
                  </Badge>
                )}
                {isDo && (
                  <span className="inline-flex items-center gap-0.5 rounded bg-gray-200 px-1.5 py-0.5 text-[10px] font-bold text-gray-700">
                    <Copy className="size-2.5" aria-hidden="true" />
                    Do
                  </span>
                )}
              </div>
              <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                {intake.prescriber_name && <span>{intake.prescriber_name}</span>}
                {intake.prescriber_institution && <span>（{intake.prescriber_institution}）</span>}
                <span>{intake.lines.length}剤</span>
                {intake.source_type === 'refill' && (
                  <Badge variant="outline" className="h-4 text-[9px]">
                    薬局保管
                  </Badge>
                )}
                {intake.refill_remaining_count != null && intake.refill_remaining_count > 0 && (
                  <Badge variant="outline" className="h-4 text-[9px]">
                    リフィル残{intake.refill_remaining_count}回
                  </Badge>
                )}
                {intake.split_dispense_total != null && intake.split_dispense_current != null && (
                  <Badge variant="outline" className="h-4 text-[9px]">
                    分割 {intake.split_dispense_current}/{intake.split_dispense_total}
                    {intake.split_next_dispense_date
                      ? ` 次回 ${fmtDate(intake.split_next_dispense_date)}`
                      : ''}
                  </Badge>
                )}
                {isFax && !originalCollected ? (
                  <Badge
                    variant={faxOriginalOverdue ? 'destructive' : 'outline'}
                    className="h-4 text-[9px]"
                  >
                    {faxOriginalOverdue ? 'FAX原本未回収' : 'FAX原本回収待ち'}
                  </Badge>
                ) : null}
                {isFax && originalCollected ? (
                  <Badge variant="outline" className="h-4 text-[9px]">
                    原本回収済{' '}
                    {intake.original_collected_at ? fmtDate(intake.original_collected_at) : ''}
                  </Badge>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </CardHeader>

      {expanded && (
        <CardContent className="p-0">
          {/* Removed drugs alert */}
          {removedDrugs.length > 0 && (
            <div className="border-t bg-red-50/50 px-4 py-2">
              <div className="flex items-start gap-2 text-xs text-red-700">
                <Minus className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                <div>
                  <span className="font-semibold">前回から中止:</span>
                  {removedDrugs.map((d) => (
                    <span key={d.id} className="ml-2">
                      {d.drug_name}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )}

          {(intake.original_document_url || (isFax && !originalCollected)) && (
            <div className="border-t bg-slate-50/60 px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="space-y-1">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-700">
                    原本管理
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {isFax
                      ? originalCollected
                        ? '訪問時回収の記録があります。'
                        : faxOriginalOverdue
                          ? 'FAX受付から3日超です。訪問時に原本回収を記録してください。'
                          : '訪問時に原本回収を記録してください。'
                      : '原本ファイルの参照状況です。'}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {intake.original_document_url ? (
                    <a
                      href={intake.original_document_url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 rounded-md border border-input bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent"
                    >
                      <ExternalLink className="size-3.5" aria-hidden="true" />
                      原本ビューア
                    </a>
                  ) : null}
                  {isFax && !originalCollected ? (
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => onMarkOriginalCollected(intake.id)}
                      disabled={isMarkingOriginalCollected}
                    >
                      <CheckCircle2 className="mr-1 size-3.5" aria-hidden="true" />
                      訪問時回収を記録
                    </Button>
                  ) : null}
                </div>
              </div>
            </div>
          )}

          {(['internal', 'external', 'injection'] as const).map((routeKey) => {
            const groups = sections[routeKey] ?? [];
            if (groups.length === 0) return null;
            const offset = rpCounter;
            rpCounter += groups.length;
            return (
              <RouteSection
                key={routeKey}
                routeKey={routeKey}
                groups={groups}
                rpOffset={offset}
                prescribedDate={intake.prescribed_date}
                prevLines={prevLines}
                overlapSet={overlapSet}
                masterMap={masterMap}
              />
            );
          })}
        </CardContent>
      )}
    </Card>
  );
}

// ─── Filter Options ─────────────────────────────────────────────────────────

const ROUTE_FILTER_OPTIONS = [
  { value: '', label: '全剤形' },
  { value: 'internal', label: '内服薬' },
  { value: 'external', label: '外用薬' },
  { value: 'injection', label: '注射薬' },
] as const;

const METHOD_FILTER_OPTIONS = [
  { value: '', label: '全調剤方法' },
  { value: 'unit_dose', label: '一包化' },
  { value: 'crushed', label: '粉砕' },
  { value: 'standard', label: '通常' },
] as const;

// ─── Main Component ─────────────────────────────────────────────────────────

export function PrescriptionHistoryContent() {
  const { id: patientId } = useParams<{ id: string }>();
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  const [routeFilter, setRouteFilter] = useState('');
  const [methodFilter, setMethodFilter] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['patient-prescriptions', orgId, patientId],
    queryFn: async () => {
      const res = await fetch(`/api/patients/${patientId}/prescriptions?limit=100`, {
        headers: { 'x-org-id': orgId },
      });
      if (!res.ok) throw new Error('処方履歴の取得に失敗しました');
      return res.json() as Promise<{ patient: PatientInfo; data: PrescriptionIntake[] }>;
    },
    enabled: !!orgId && !!patientId,
  });

  // Batch-fetch DrugMaster info for all drug_codes
  const allDrugCodes = useMemo(() => {
    if (!data?.data) return [];
    const codes = new Set<string>();
    for (const intake of data.data) {
      for (const line of intake.lines) {
        if (line.drug_code) codes.add(line.drug_code);
      }
    }
    return Array.from(codes);
  }, [data]);

  const { data: masterData } = useQuery({
    queryKey: ['drug-masters-batch', orgId, allDrugCodes],
    queryFn: async () => {
      if (allDrugCodes.length === 0) return {};
      const res = await fetch('/api/drug-masters/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-org-id': orgId },
        body: JSON.stringify({ yj_codes: allDrugCodes }),
      });
      if (!res.ok) return {};
      return res.json() as Promise<Record<string, DrugMasterInfo>>;
    },
    enabled: !!orgId && allDrugCodes.length > 0,
    staleTime: 5 * 60_000,
  });

  const masterMap: Record<string, DrugMasterInfo> = masterData ?? {};

  const markOriginalCollectedMutation = useMutation({
    mutationFn: async (intakeId: string) => {
      const response = await fetch(`/api/prescription-intakes/${intakeId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'x-org-id': orgId,
        },
        body: JSON.stringify({
          original_collected_at: new Date().toISOString(),
        }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.message ?? '原本回収の記録に失敗しました');
      }
      return response.json();
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ['patient-prescriptions', orgId, patientId],
      });
      toast.success('FAX原本の回収を記録しました');
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const filteredIntakes = useMemo(() => {
    if (!data?.data) return [];
    if (!routeFilter && !methodFilter) return data.data;
    return data.data
      .map((intake) => ({
        ...intake,
        lines: intake.lines.filter((line) => {
          if (routeFilter && inferRoute(line) !== routeFilter) return false;
          if (methodFilter && inferMethod(line) !== methodFilter) return false;
          return true;
        }),
      }))
      .filter((intake) => intake.lines.length > 0);
  }, [data, routeFilter, methodFilter]);

  const overlapSet = useMemo(() => buildOverlapSet(data?.data ?? []), [data]);
  const latestIntake = data?.data?.[0] ?? null;
  const previousIntake = data?.data?.[1] ?? null;
  const overviewCards = useMemo(() => buildOverviewCards(data?.data ?? []), [data]);
  const latestChanges = useMemo(
    () => buildLatestChangeSummary(latestIntake, previousIntake),
    [latestIntake, previousIntake],
  );
  const dispensingOverview = useMemo(() => buildDispensingOverview(latestIntake), [latestIntake]);

  const stats = useMemo(() => {
    if (!data?.data) return null;
    let totalLines = 0,
      unitDose = 0,
      crushed = 0,
      external = 0,
      injection = 0,
      warnings = 0;
    for (const intake of data.data) {
      for (const line of intake.lines) {
        totalLines++;
        const method = inferMethod(line);
        if (method === 'unit_dose') {
          unitDose++;
          if (isUnitDoseIncompatible(line)) warnings++;
        }
        if (method === 'crushed') {
          crushed++;
          if (isCrushedIncompatible(line)) warnings++;
        }
        const route = inferRoute(line);
        if (route === 'external') external++;
        if (route === 'injection') injection++;
      }
    }
    return {
      total: data.data.length,
      totalLines,
      unitDose,
      crushed,
      external,
      injection,
      warnings,
      overlaps: overlapSet.size,
    };
  }, [data, overlapSet]);

  const handlePrint = useCallback(() => window.print(), []);

  if (isLoading) return <Loading />;

  return (
    <div className="space-y-4">
      {/* Header */}
      {data?.patient && (
        <div className="flex items-center justify-between print:justify-start">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-bold">{data.patient.name}</h2>
            {data.patient.name_kana && (
              <span className="text-sm text-muted-foreground">({data.patient.name_kana})</span>
            )}
          </div>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 print:hidden"
            onClick={handlePrint}
          >
            <Printer className="size-3.5" aria-hidden="true" />
            印刷
          </Button>
        </div>
      )}

      {/* Stats bar */}
      {stats && (
        <div className="flex flex-wrap gap-2 print:hidden">
          <Badge variant="outline">{stats.total}回の処方</Badge>
          <Badge variant="outline">{stats.totalLines}剤</Badge>
          {stats.unitDose > 0 && (
            <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100">
              一包化 {stats.unitDose}
            </Badge>
          )}
          {stats.crushed > 0 && (
            <Badge className="bg-red-100 text-red-800 hover:bg-red-100">粉砕 {stats.crushed}</Badge>
          )}
          {stats.external > 0 && (
            <Badge className="bg-green-100 text-green-800 hover:bg-green-100">
              外用 {stats.external}
            </Badge>
          )}
          {stats.injection > 0 && (
            <Badge className="bg-purple-100 text-purple-800 hover:bg-purple-100">
              注射 {stats.injection}
            </Badge>
          )}
          {stats.warnings > 0 && (
            <Badge className="bg-red-200 text-red-900 hover:bg-red-200">
              <AlertTriangle className="mr-0.5 size-3" aria-hidden="true" />
              警告 {stats.warnings}
            </Badge>
          )}
          {stats.overlaps > 0 && (
            <Badge className="bg-red-200 text-red-900 hover:bg-red-200">
              期間重複 {(stats.overlaps / 2) | 0}件
            </Badge>
          )}
        </div>
      )}

      {overviewCards.length > 0 && (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {overviewCards.map((item) => (
            <Card key={item.label} className="border-slate-200 shadow-sm">
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-muted-foreground">{item.label}</p>
                  <HelpPopover title={item.label} description={item.description} />
                </div>
                <p className="flex items-center gap-2 font-heading text-xl leading-snug font-medium">
                  <CalendarDays className="size-4 text-sky-700" aria-hidden="true" />
                  {item.value}
                </p>
              </CardHeader>
            </Card>
          ))}
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        <Card className="border-slate-200 shadow-sm">
          <CardHeader>
            <h2 className="font-heading text-base leading-snug font-medium">
              処方変更ダッシュボード
            </h2>
            <CardDescription>最新処方と前回処方の差分を先に確認できます。</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {latestChanges.length === 0 ? (
              <p className="text-sm text-muted-foreground">前回から大きな変更はありません。</p>
            ) : (
              latestChanges.map((item) => (
                <div
                  key={`${item.drugName}-${item.label}`}
                  className="rounded-xl border border-slate-200 bg-white p-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium text-foreground">{item.drugName}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{item.detail}</p>
                    </div>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${item.color}`}
                    >
                      {item.label}
                    </span>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card className="border-slate-200 shadow-sm">
          <CardHeader>
            <h2 className="font-heading text-base leading-snug font-medium">調剤方法ワンビュー</h2>
            <CardDescription>
              最新処方の一包化、粉砕、包装指示、注意事項をまとめています。
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {dispensingOverview.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                最新処方に特別な調剤指示はありません。
              </p>
            ) : (
              dispensingOverview.map((item) => (
                <div
                  key={`${item.drugName}-${item.note}`}
                  className="rounded-xl border border-slate-200 bg-white p-3"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium text-foreground">{item.drugName}</p>
                        <Badge variant="outline">{item.routeLabel}</Badge>
                        {item.hasWarning ? (
                          <Badge className="bg-red-100 text-red-800 hover:bg-red-100">要確認</Badge>
                        ) : null}
                      </div>
                      <p className="mt-1 text-xs leading-5 text-muted-foreground">{item.note}</p>
                    </div>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      {latestIntake && previousIntake ? (
        <div className="hidden md:grid md:gap-4 xl:hidden">
          <div className="flex items-end justify-between gap-3">
            <div>
              <h3 className="text-base font-semibold text-foreground">処方差分 2ペイン</h3>
              <p className="text-sm text-muted-foreground">
                タブレットでは最新処方と前回処方を並べて確認できます。
              </p>
            </div>
            <Badge variant="outline">今回 / 前回</Badge>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-foreground">今回</p>
                <p className="text-xs text-muted-foreground">
                  {fmtDate(latestIntake.prescribed_date)}
                </p>
              </div>
              <PrescriptionIntakeCard
                intake={latestIntake}
                prevIntake={previousIntake}
                overlapSet={overlapSet}
                masterMap={masterMap}
                onMarkOriginalCollected={(intakeId) =>
                  markOriginalCollectedMutation.mutate(intakeId)
                }
                isMarkingOriginalCollected={markOriginalCollectedMutation.isPending}
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-foreground">前回</p>
                <p className="text-xs text-muted-foreground">
                  {fmtDate(previousIntake.prescribed_date)}
                </p>
              </div>
              <PrescriptionIntakeCard
                intake={previousIntake}
                prevIntake={null}
                overlapSet={overlapSet}
                masterMap={masterMap}
                onMarkOriginalCollected={(intakeId) =>
                  markOriginalCollectedMutation.mutate(intakeId)
                }
                isMarkingOriginalCollected={markOriginalCollectedMutation.isPending}
              />
            </div>
          </div>
        </div>
      ) : null}

      {/* Filters */}
      <div className="flex items-center gap-3 print:hidden">
        <select
          value={routeFilter}
          onChange={(e) => setRouteFilter(e.target.value)}
          className="h-8 rounded-md border border-input bg-background px-2 text-sm"
          aria-label="剤形フィルタ"
        >
          {ROUTE_FILTER_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <select
          value={methodFilter}
          onChange={(e) => setMethodFilter(e.target.value)}
          className="h-8 rounded-md border border-input bg-background px-2 text-sm"
          aria-label="調剤方法フィルタ"
        >
          {METHOD_FILTER_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      {/* Timeline */}
      {filteredIntakes.length === 0 ? (
        <div className="flex min-h-[200px] items-center justify-center rounded-lg border border-dashed">
          <p className="text-sm text-muted-foreground">処方履歴がありません</p>
        </div>
      ) : (
        <div className="relative space-y-3">
          <div
            className="absolute left-[19px] top-4 bottom-4 w-px bg-border print:hidden"
            aria-hidden="true"
          />
          {filteredIntakes.map((intake, idx) => {
            const prevIntake = idx < filteredIntakes.length - 1 ? filteredIntakes[idx + 1] : null;
            return (
              <div key={intake.id} className="relative pl-10 print:pl-0">
                <div
                  className="absolute left-3.5 top-4 size-2.5 rounded-full border-2 border-primary bg-background print:hidden"
                  aria-hidden="true"
                />
                <PrescriptionIntakeCard
                  intake={intake}
                  prevIntake={prevIntake}
                  overlapSet={overlapSet}
                  masterMap={masterMap}
                  onMarkOriginalCollected={(intakeId) =>
                    markOriginalCollectedMutation.mutate(intakeId)
                  }
                  isMarkingOriginalCollected={markOriginalCollectedMutation.isPending}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
