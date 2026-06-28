'use client';

import { AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { StateBadge } from '@/components/ui/state-badge';
import type { CareManagerReportContent } from '@/types/care-report-content';
import { formatReportDate } from './report-date-format';

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold text-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function ImpactCard({ label, value }: { label: string; value: string }) {
  const hasIssue = value !== 'no_issues' && value !== '' && value !== '問題なし';
  return (
    <div
      className={`rounded-md border p-3 ${
        hasIssue ? 'border-state-confirm/30 bg-state-confirm/10' : 'border-border bg-muted/20'
      }`}
    >
      <p className="mb-1 text-xs font-medium text-muted-foreground">{label}</p>
      <p className={`text-sm font-medium ${hasIssue ? 'text-state-confirm' : 'text-foreground'}`}>
        {value || '問題なし'}
      </p>
    </div>
  );
}

function BoolItem({ label, value }: { label: string; value: boolean }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      {value ? (
        <CheckCircle2 className="size-4 shrink-0 text-state-done" aria-hidden="true" />
      ) : (
        <XCircle className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      )}
      <span className={value ? 'text-foreground' : 'text-muted-foreground'}>{label}</span>
    </div>
  );
}

export function CareManagerReportView({ content }: { content: CareManagerReportContent }) {
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

      {/* Recipient (care manager) */}
      <SectionCard title="宛先">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
          <div>
            <dt className="text-xs text-muted-foreground">ケアマネジャー名</dt>
            <dd className="mt-0.5 font-medium">{content.care_manager.name || '—'}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">事業所名</dt>
            <dd className="mt-0.5">{content.care_manager.organization || '—'}</dd>
          </div>
        </dl>
      </SectionCard>

      {/* Patient info */}
      <SectionCard title="患者情報">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
          <div>
            <dt className="text-xs text-muted-foreground">氏名</dt>
            <dd className="mt-0.5 font-medium">{content.patient.name}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">生年月日</dt>
            <dd className="mt-0.5">{formatReportDate(content.patient.birth_date)}</dd>
          </div>
        </dl>
      </SectionCard>

      {/* Medication management summary */}
      <SectionCard title="服薬管理概要">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm md:grid-cols-4">
          <div>
            <dt className="text-xs text-muted-foreground">薬剤数</dt>
            <dd className="mt-0.5 font-medium tabular-nums">
              {content.medication_management_summary.total_drugs}種類
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">服薬遵守度</dt>
            <dd className="mt-0.5">
              {content.medication_management_summary.compliance_summary || '—'}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">自己管理</dt>
            <dd className="mt-0.5">
              {content.medication_management_summary.self_management || '—'}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">服薬カレンダー</dt>
            <dd className="mt-0.5">
              {content.medication_management_summary.calendar_used ? '使用あり' : '使用なし'}
            </dd>
          </div>
        </dl>
      </SectionCard>

      {/* Functional impact */}
      <SectionCard title="生活機能への影響（5項目）">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          <ImpactCard label="睡眠" value={content.functional_impact.sleep_impact} />
          <ImpactCard label="認知機能" value={content.functional_impact.cognition_impact} />
          <ImpactCard label="食事・口腔" value={content.functional_impact.diet_impact} />
          <ImpactCard label="運動・歩行" value={content.functional_impact.mobility_impact} />
          <ImpactCard label="排泄" value={content.functional_impact.excretion_impact} />
        </div>
      </SectionCard>

      {/* Residual medications */}
      <SectionCard title="残薬状況">
        <div className="space-y-2 text-sm">
          <p className="text-muted-foreground">{content.residual_status.summary || '特になし'}</p>
          {content.residual_status.reduction_proposals.length > 0 && (
            <div className="mt-2">
              <p className="mb-1.5 text-xs font-medium text-muted-foreground">減数提案</p>
              <ul className="space-y-1">
                {content.residual_status.reduction_proposals.map((proposal, i) => (
                  <li key={i} className="flex items-start gap-1.5 text-sm">
                    <span
                      className="mt-1 size-1.5 shrink-0 rounded-full bg-state-confirm"
                      aria-hidden="true"
                    />
                    {proposal}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </SectionCard>

      {/* Care service coordination */}
      <SectionCard title="介護サービスとの連携">
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <BoolItem
              label="服薬介助あり"
              value={!!content.care_service_coordination.medication_assistance}
            />
            <BoolItem
              label="一包化対応"
              value={content.care_service_coordination.unit_dose_packaging}
            />
            <BoolItem
              label="服薬カレンダー推奨"
              value={content.care_service_coordination.calendar_recommendation}
            />
          </div>
          {content.care_service_coordination.medication_assistance && (
            <p className="mt-2 text-xs text-muted-foreground">
              服薬介助: {content.care_service_coordination.medication_assistance}
            </p>
          )}
          {content.care_service_coordination.other_items && (
            <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">
              {content.care_service_coordination.other_items}
            </p>
          )}
        </div>
      </SectionCard>

      {/* Next visit plan */}
      <SectionCard title="今後の計画">
        <div className="space-y-3 text-sm">
          {content.next_visit_plan.date && (
            <div>
              <p className="text-xs text-muted-foreground">次回訪問予定日</p>
              <p className="mt-0.5 font-medium">{formatReportDate(content.next_visit_plan.date)}</p>
            </div>
          )}
          {content.next_visit_plan.followup_items.length > 0 && (
            <div>
              <p className="mb-1.5 text-xs text-muted-foreground">フォローアップ項目</p>
              <ul className="space-y-1">
                {content.next_visit_plan.followup_items.map((item, i) => (
                  <li key={i} className="flex items-start gap-1.5">
                    <span
                      className="mt-1 size-1.5 shrink-0 rounded-full bg-primary"
                      aria-hidden="true"
                    />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {!content.next_visit_plan.date && content.next_visit_plan.followup_items.length === 0 && (
            <p className="text-muted-foreground">記載なし</p>
          )}
        </div>
      </SectionCard>
    </div>
  );
}
