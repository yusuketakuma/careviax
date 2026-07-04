'use client';

import type { ColumnDef } from '@tanstack/react-table';
import { AlertTriangle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { DataTable, type DataTableColumnMeta } from '@/components/ui/data-table';
import { StateBadge } from '@/components/ui/state-badge';
import { ADHERENCE_LABELS } from '@/lib/constants/soap-options';
import type { PhysicianReportContent } from '@/types/care-report-content';
import { formatReportDate } from './report-date-format';
import { SectionCard } from './section-card';

const GENDER_LABELS: Record<string, string> = {
  male: '男性',
  female: '女性',
  other: 'その他',
};

function FunctionalItem({ label, value }: { label: string; value: string }) {
  const hasIssue = value !== 'no_issues' && value !== '' && value !== '問題なし';
  return (
    <div
      className={`flex items-start justify-between rounded-md px-3 py-2 text-sm ${
        hasIssue ? 'bg-state-confirm/10 ring-1 ring-state-confirm/30' : 'bg-muted/30'
      }`}
    >
      <span className="font-medium text-muted-foreground">{label}</span>
      <span
        className={`ml-2 text-right ${hasIssue ? 'font-semibold text-state-confirm' : 'text-foreground'}`}
      >
        {value || '—'}
      </span>
    </div>
  );
}

type PrescriptionReportRow = PhysicianReportContent['prescriptions'][number];
type ResidualMedicationReportRow = PhysicianReportContent['residual_medications'][number];

const prescriptionColumns: ColumnDef<PrescriptionReportRow>[] = [
  {
    accessorKey: 'drug_name',
    header: '薬剤名',
    enableSorting: false,
    meta: { mobileLabel: '薬剤名' } satisfies DataTableColumnMeta<PrescriptionReportRow>,
    cell: ({ row }) => <span className="font-medium">{row.original.drug_name}</span>,
  },
  {
    accessorKey: 'dose',
    header: '用量',
    enableSorting: false,
    meta: { mobileLabel: '用量' } satisfies DataTableColumnMeta<PrescriptionReportRow>,
    cell: ({ row }) => <span className="text-muted-foreground">{row.original.dose}</span>,
  },
  {
    accessorKey: 'frequency',
    header: '用法',
    enableSorting: false,
    meta: { mobileLabel: '用法' } satisfies DataTableColumnMeta<PrescriptionReportRow>,
    cell: ({ row }) => <span className="text-muted-foreground">{row.original.frequency}</span>,
  },
  {
    accessorKey: 'days',
    header: '日数',
    enableSorting: false,
    meta: { mobileLabel: '日数' } satisfies DataTableColumnMeta<PrescriptionReportRow>,
    cell: ({ row }) => <span className="tabular-nums">{row.original.days}日</span>,
  },
];

const residualMedicationColumns: ColumnDef<ResidualMedicationReportRow>[] = [
  {
    accessorKey: 'drug_name',
    header: '薬剤名',
    enableSorting: false,
    meta: { mobileLabel: '薬剤名' } satisfies DataTableColumnMeta<ResidualMedicationReportRow>,
  },
  {
    accessorKey: 'remaining_qty',
    header: '残数',
    enableSorting: false,
    meta: { mobileLabel: '残数' } satisfies DataTableColumnMeta<ResidualMedicationReportRow>,
    cell: ({ row }) => <span className="tabular-nums">{row.original.remaining_qty}</span>,
  },
  {
    accessorKey: 'excess_days',
    header: '余剰日数',
    enableSorting: false,
    meta: { mobileLabel: '余剰日数' } satisfies DataTableColumnMeta<ResidualMedicationReportRow>,
    cell: ({ row }) => <span className="tabular-nums">{row.original.excess_days}日</span>,
  },
  {
    accessorKey: 'reduction_proposal',
    header: '減数提案',
    enableSorting: false,
    meta: { mobileLabel: '減数提案' } satisfies DataTableColumnMeta<ResidualMedicationReportRow>,
    cell: ({ row }) =>
      row.original.reduction_proposal ? (
        <StateBadge role="info">提案あり</StateBadge>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
  },
];

export function PhysicianReportView({ content }: { content: PhysicianReportContent }) {
  const adherenceCfg = ADHERENCE_LABELS[content.medication_management.adherence_score];
  // その他薬(セット外で持参)に分類された処方のみ抜き出す(§11-7)。
  const outsideMeds = content.prescriptions.filter((rx) => rx.outside_med_kind);

  return (
    <div className="space-y-4">
      {/* Warnings */}
      {content.warnings.length > 0 && (
        <div className="rounded-lg border-l-4 border-border/70 border-l-state-confirm bg-card p-3">
          <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-state-confirm">
            <AlertTriangle className="size-3.5" aria-hidden="true" />
            算定要件の未充足項目
          </p>
          <div className="flex flex-wrap gap-1.5">
            {content.warnings.map((w, i) => (
              <StateBadge key={i} role="confirm">
                {w}
              </StateBadge>
            ))}
          </div>
        </div>
      )}

      {/* Header info */}
      <SectionCard title="基本情報">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm md:grid-cols-3">
          <div>
            <dt className="text-xs text-muted-foreground">報告日</dt>
            <dd className="mt-0.5 font-medium">{formatReportDate(content.report_date)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">訪問日</dt>
            <dd className="mt-0.5 font-medium">{formatReportDate(content.visit_date)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">担当薬剤師</dt>
            <dd className="mt-0.5 font-medium">{content.pharmacist_name}</dd>
          </div>
        </dl>
      </SectionCard>

      {/* Patient info */}
      <SectionCard title="患者情報">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm md:grid-cols-3">
          <div>
            <dt className="text-xs text-muted-foreground">氏名</dt>
            <dd className="mt-0.5 font-medium">{content.patient.name}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">生年月日</dt>
            <dd className="mt-0.5">{formatReportDate(content.patient.birth_date)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">性別</dt>
            <dd className="mt-0.5">
              {GENDER_LABELS[content.patient.gender] ?? content.patient.gender}
            </dd>
          </div>
        </dl>
      </SectionCard>

      {/* Prescriber */}
      <SectionCard title="処方医">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
          <div>
            <dt className="text-xs text-muted-foreground">医師名</dt>
            <dd className="mt-0.5 font-medium">{content.prescriber.name}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">医療機関名</dt>
            <dd className="mt-0.5">{content.prescriber.institution}</dd>
          </div>
        </dl>
      </SectionCard>

      {/* Prescriptions */}
      {content.prescriptions.length > 0 && (
        <SectionCard title="処方内容">
          <DataTable
            columns={prescriptionColumns}
            data={content.prescriptions}
            caption="処方薬一覧"
          />
        </SectionCard>
      )}

      {/* Outside meds (§11-7) */}
      {outsideMeds.length > 0 && (
        <SectionCard title="その他薬（セット外で持参）">
          <ul className="space-y-2 text-sm">
            {outsideMeds.map((rx, i) => (
              <li
                key={i}
                className="flex flex-wrap items-center gap-2 rounded-md border border-border px-3 py-2"
              >
                <Badge variant="outline">{rx.outside_med_label}</Badge>
                <span className="font-medium">{rx.drug_name}</span>
                {rx.dose ? <span className="text-muted-foreground">{rx.dose}</span> : null}
              </li>
            ))}
          </ul>
        </SectionCard>
      )}

      {/* Medication management */}
      <SectionCard title="服薬管理状況">
        <div className="space-y-3 text-sm">
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground">アドヒアランス</span>
            {adherenceCfg ? (
              <Badge className={`${adherenceCfg.color} border-0`}>
                {content.medication_management.adherence_score}点 — {adherenceCfg.label}
              </Badge>
            ) : (
              <span>{content.medication_management.adherence_score}点</span>
            )}
          </div>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 md:grid-cols-3">
            <div>
              <dt className="text-xs text-muted-foreground">服薬状況</dt>
              <dd className="mt-0.5">{content.medication_management.compliance_summary || '—'}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">自己管理</dt>
              <dd className="mt-0.5">{content.medication_management.self_management || '—'}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">服薬カレンダー</dt>
              <dd className="mt-0.5">
                {content.medication_management.calendar_used ? '使用あり' : '使用なし'}
              </dd>
            </div>
          </dl>
        </div>
      </SectionCard>

      {/* Adverse events */}
      <SectionCard title="薬物有害事象">
        <div className="space-y-2 text-sm">
          <div className="flex items-center gap-2">
            <Badge variant={content.adverse_events.has_events ? 'destructive' : 'secondary'}>
              {content.adverse_events.has_events ? 'あり' : 'なし'}
            </Badge>
          </div>
          {content.adverse_events.has_events && content.adverse_events.events.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {content.adverse_events.events.map((ev, i) => (
                <Badge key={i} variant="outline" className="text-destructive border-destructive/30">
                  {ev}
                </Badge>
              ))}
            </div>
          )}
          {content.adverse_events.details && (
            <p className="whitespace-pre-wrap text-muted-foreground">
              {content.adverse_events.details}
            </p>
          )}
        </div>
      </SectionCard>

      {/* Functional assessment */}
      <SectionCard title="薬学的機能評価（6項目）">
        <div className="space-y-1.5">
          {content.functional_assessment.lab_values && (
            <div className="mb-2 rounded-md bg-muted/30 px-3 py-2 text-sm">
              <span className="text-xs font-medium text-muted-foreground">検査値: </span>
              {content.functional_assessment.lab_values}
            </div>
          )}
          <FunctionalItem label="睡眠" value={content.functional_assessment.sleep} />
          <FunctionalItem label="認知・感覚" value={content.functional_assessment.cognition} />
          <FunctionalItem label="食事・口腔" value={content.functional_assessment.diet_oral} />
          <FunctionalItem label="歩行・運動" value={content.functional_assessment.mobility} />
          <FunctionalItem label="排泄" value={content.functional_assessment.excretion} />
        </div>
      </SectionCard>

      {/* Residual medications */}
      {content.residual_medications.length > 0 && (
        <SectionCard title="残薬状況">
          <DataTable
            columns={residualMedicationColumns}
            data={content.residual_medications}
            caption="残薬一覧"
          />
        </SectionCard>
      )}

      {/* Assessment */}
      <SectionCard title="薬学的評価">
        <p className="whitespace-pre-wrap text-sm leading-relaxed">
          {content.assessment || <span className="text-muted-foreground">記載なし</span>}
        </p>
      </SectionCard>

      {/* Plan */}
      <SectionCard title="今後の計画">
        <p className="whitespace-pre-wrap text-sm leading-relaxed">
          {content.plan || <span className="text-muted-foreground">記載なし</span>}
        </p>
      </SectionCard>

      {/* Prescription proposals */}
      {content.prescription_proposals && (
        <SectionCard title="処方提案">
          <p className="whitespace-pre-wrap text-sm leading-relaxed">
            {content.prescription_proposals}
          </p>
        </SectionCard>
      )}

      {/* Physician communication */}
      <SectionCard title="処方医への連絡事項">
        <p className="whitespace-pre-wrap text-sm leading-relaxed">
          {content.physician_communication || (
            <span className="text-muted-foreground">特になし</span>
          )}
        </p>
      </SectionCard>
    </div>
  );
}
