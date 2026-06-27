'use client';

import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';
import { getReportPrintShortcutLinks } from '@/components/features/workflow/page-shortcut-presets';
import { PrintPageToolbar } from '@/components/features/workflow/print-page-toolbar';
import { PrintLayout } from '@/components/features/reports/print-layout';
import { Loading } from '@/components/ui/loading';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { readApiJson } from '@/lib/api/client-json';
import { buildOrgJsonHeaders } from '@/lib/api/org-headers';
import { buildCareReportPrintAuditApiPath } from '@/lib/reports/api-paths';
import { buildReportHref } from '@/lib/reports/navigation';
import type {
  PhysicianReportContent,
  CareManagerReportContent,
  AudienceReportContent,
} from '@/types/care-report-content';
import {
  careReportPrintAuditResponseSchema,
  type CareReportPrintAuditPrintableReport,
  type CareReportPrintAuditResponse,
} from '@/lib/reports/care-report-print-audit-contract';

// ─── Physician report layout (別紙様式1準拠) ─────────────────────────────────

function PhysicianReportPrint({ content }: { content: PhysicianReportContent }) {
  const reportDate = content.report_date
    ? new Date(content.report_date).toLocaleDateString('ja-JP')
    : '—';
  const visitDate = content.visit_date
    ? new Date(content.visit_date).toLocaleDateString('ja-JP')
    : '—';

  return (
    <div className="space-y-4 text-sm">
      {/* Title */}
      <h1 className="border-b-2 border-black pb-2 text-center text-xl font-bold">
        在宅患者訪問薬剤管理指導 報告書
      </h1>

      {/* Header info */}
      <table className="w-full border border-gray-400 text-xs">
        <tbody>
          <tr>
            <th className="w-1/6 bg-gray-100 px-2 py-1 text-left">報告日</th>
            <td className="px-2 py-1">{reportDate}</td>
            <th className="w-1/6 bg-gray-100 px-2 py-1 text-left">訪問日</th>
            <td className="px-2 py-1">{visitDate}</td>
          </tr>
          <tr>
            <th className="bg-gray-100 px-2 py-1 text-left">患者名</th>
            <td className="px-2 py-1">
              {content.patient.name} 様（
              {content.patient.gender === 'M' ? '男性' : '女性'}、
              {content.patient.birth_date
                ? new Date(content.patient.birth_date).toLocaleDateString('ja-JP', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                  })
                : '—'}
              生）
            </td>
            <th className="bg-gray-100 px-2 py-1 text-left">処方医</th>
            <td className="px-2 py-1">
              {content.prescriber.name} 先生（{content.prescriber.institution}）
            </td>
          </tr>
        </tbody>
      </table>

      {/* 処方内容 */}
      <section>
        <h2 className="mb-1 bg-gray-800 px-2 py-1 text-sm font-bold text-white">【処方内容】</h2>
        <table className="w-full border border-gray-400 text-xs">
          <thead>
            <tr>
              <th className="bg-gray-100 px-2 py-1 text-left">薬剤名</th>
              <th className="bg-gray-100 px-2 py-1 text-left">用量</th>
              <th className="bg-gray-100 px-2 py-1 text-left">用法</th>
              <th className="bg-gray-100 px-2 py-1 text-left">日数</th>
              <th className="bg-gray-100 px-2 py-1 text-left">投与経路</th>
            </tr>
          </thead>
          <tbody>
            {content.prescriptions.map((rx, i) => (
              <tr key={i}>
                <td className="px-2 py-1">{rx.drug_name}</td>
                <td className="px-2 py-1">{rx.dose}</td>
                <td className="px-2 py-1">{rx.frequency}</td>
                <td className="px-2 py-1">{rx.days}日分</td>
                <td className="px-2 py-1">{rx.route ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* 服薬管理状況 */}
      <section>
        <h2 className="mb-1 bg-gray-800 px-2 py-1 text-sm font-bold text-white">
          【服薬管理状況】
        </h2>
        <table className="w-full border border-gray-400 text-xs">
          <tbody>
            <tr>
              <th className="w-1/4 bg-gray-100 px-2 py-1 text-left">服薬遵守</th>
              <td className="px-2 py-1">{content.medication_management.compliance_summary}</td>
              <th className="w-1/4 bg-gray-100 px-2 py-1 text-left">アドヒアランス</th>
              <td className="px-2 py-1">{content.medication_management.adherence_score}/5</td>
            </tr>
            <tr>
              <th className="bg-gray-100 px-2 py-1 text-left">自己管理</th>
              <td className="px-2 py-1">{content.medication_management.self_management}</td>
              <th className="bg-gray-100 px-2 py-1 text-left">服薬カレンダー</th>
              <td className="px-2 py-1">
                {content.medication_management.calendar_used ? '使用あり' : '使用なし'}
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      {/* 薬物有害事象 */}
      <section>
        <h2 className="mb-1 bg-gray-800 px-2 py-1 text-sm font-bold text-white">
          【薬物有害事象】
        </h2>
        <div className="border border-gray-400 px-3 py-2 text-xs">
          {content.adverse_events.has_events ? (
            <span>
              あり：{content.adverse_events.events.join('、')}
              {content.adverse_events.details ? `（${content.adverse_events.details}）` : ''}
            </span>
          ) : (
            <span>なし</span>
          )}
        </div>
      </section>

      {/* 薬学的評価（7項目） */}
      <section>
        <h2 className="mb-1 bg-gray-800 px-2 py-1 text-sm font-bold text-white">【薬学的評価】</h2>
        <table className="w-full border border-gray-400 text-xs">
          <tbody>
            <tr>
              <th className="w-1/6 bg-gray-100 px-2 py-1 text-left">①検査値</th>
              <td className="px-2 py-1">{content.functional_assessment.lab_values ?? '—'}</td>
              <th className="w-1/6 bg-gray-100 px-2 py-1 text-left">②睡眠</th>
              <td className="px-2 py-1">{content.functional_assessment.sleep}</td>
            </tr>
            <tr>
              <th className="bg-gray-100 px-2 py-1 text-left">③認知</th>
              <td className="px-2 py-1">{content.functional_assessment.cognition}</td>
              <th className="bg-gray-100 px-2 py-1 text-left">④食事口腔</th>
              <td className="px-2 py-1">{content.functional_assessment.diet_oral}</td>
            </tr>
            <tr>
              <th className="bg-gray-100 px-2 py-1 text-left">⑤歩行運動</th>
              <td className="px-2 py-1">{content.functional_assessment.mobility}</td>
              <th className="bg-gray-100 px-2 py-1 text-left">⑥排泄</th>
              <td className="px-2 py-1">{content.functional_assessment.excretion}</td>
            </tr>
          </tbody>
        </table>
      </section>

      {/* 残薬状況 */}
      {content.residual_medications.length > 0 && (
        <section>
          <h2 className="mb-1 bg-gray-800 px-2 py-1 text-sm font-bold text-white">【残薬状況】</h2>
          <table className="w-full border border-gray-400 text-xs">
            <thead>
              <tr>
                <th className="bg-gray-100 px-2 py-1 text-left">薬剤名</th>
                <th className="bg-gray-100 px-2 py-1 text-left">残量</th>
                <th className="bg-gray-100 px-2 py-1 text-left">超過日数</th>
                <th className="bg-gray-100 px-2 py-1 text-left">減量提案</th>
              </tr>
            </thead>
            <tbody>
              {content.residual_medications.map((r, i) => (
                <tr key={i}>
                  <td className="px-2 py-1">{r.drug_name}</td>
                  <td className="px-2 py-1">{r.remaining_qty}</td>
                  <td className="px-2 py-1">{r.excess_days}日</td>
                  <td className="px-2 py-1">{r.reduction_proposal ? 'あり' : 'なし'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {/* 薬学的介入・評価 */}
      <section>
        <h2 className="mb-1 bg-gray-800 px-2 py-1 text-sm font-bold text-white">
          【薬学的介入・評価】
        </h2>
        <div className="min-h-[60px] border border-gray-400 px-3 py-2 text-xs whitespace-pre-wrap">
          {content.assessment}
        </div>
      </section>

      {/* 今後の計画 */}
      <section>
        <h2 className="mb-1 bg-gray-800 px-2 py-1 text-sm font-bold text-white">【今後の計画】</h2>
        <div className="min-h-[60px] border border-gray-400 px-3 py-2 text-xs whitespace-pre-wrap">
          {content.plan}
        </div>
      </section>

      {/* 処方医への連絡・処方提案事項 */}
      {content.physician_communication && (
        <section>
          <h2 className="mb-1 bg-gray-800 px-2 py-1 text-sm font-bold text-white">
            【処方医への連絡・処方提案事項】
          </h2>
          <div className="min-h-[60px] border border-gray-400 px-3 py-2 text-xs whitespace-pre-wrap">
            {content.physician_communication}
          </div>
        </section>
      )}

      {/* Footer */}
      <div className="mt-6 border-t pt-2 text-right text-xs">薬剤師: {content.pharmacist_name}</div>
    </div>
  );
}

// ─── Care manager report layout ───────────────────────────────────────────────

function CareManagerReportPrint({ content }: { content: CareManagerReportContent }) {
  const reportDate = content.report_date
    ? new Date(content.report_date).toLocaleDateString('ja-JP')
    : '—';
  const visitDate = content.visit_date
    ? new Date(content.visit_date).toLocaleDateString('ja-JP')
    : '—';

  return (
    <div className="space-y-4 text-sm">
      {/* Title */}
      <h1 className="border-b-2 border-black pb-2 text-center text-xl font-bold">
        居宅療養管理指導（薬剤師）情報提供書
      </h1>

      {/* Addressee */}
      <div className="text-xs">
        <p>
          {content.care_manager.organization}　{content.care_manager.name} 様
        </p>
      </div>

      {/* Header info */}
      <table className="w-full border border-gray-400 text-xs">
        <tbody>
          <tr>
            <th className="w-1/6 bg-gray-100 px-2 py-1 text-left">報告日</th>
            <td className="px-2 py-1">{reportDate}</td>
            <th className="w-1/6 bg-gray-100 px-2 py-1 text-left">訪問日</th>
            <td className="px-2 py-1">{visitDate}</td>
          </tr>
          <tr>
            <th className="bg-gray-100 px-2 py-1 text-left">患者名</th>
            <td colSpan={3} className="px-2 py-1">
              {content.patient.name} 様
            </td>
          </tr>
        </tbody>
      </table>

      {/* 服薬管理概要 */}
      <section>
        <h2 className="mb-1 bg-gray-800 px-2 py-1 text-sm font-bold text-white">
          【服薬管理概要】
        </h2>
        <table className="w-full border border-gray-400 text-xs">
          <tbody>
            <tr>
              <th className="w-1/4 bg-gray-100 px-2 py-1 text-left">管理薬剤数</th>
              <td className="px-2 py-1">{content.medication_management_summary.total_drugs}種類</td>
              <th className="w-1/4 bg-gray-100 px-2 py-1 text-left">服薬遵守</th>
              <td className="px-2 py-1">
                {content.medication_management_summary.compliance_summary}
              </td>
            </tr>
            <tr>
              <th className="bg-gray-100 px-2 py-1 text-left">自己管理</th>
              <td className="px-2 py-1">{content.medication_management_summary.self_management}</td>
              <th className="bg-gray-100 px-2 py-1 text-left">服薬カレンダー</th>
              <td className="px-2 py-1">
                {content.medication_management_summary.calendar_used ? '使用あり' : '使用なし'}
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      {/* 生活機能への影響（5項目） */}
      <section>
        <h2 className="mb-1 bg-gray-800 px-2 py-1 text-sm font-bold text-white">
          【生活機能への影響】
        </h2>
        <table className="w-full border border-gray-400 text-xs">
          <tbody>
            <tr>
              <th className="w-1/6 bg-gray-100 px-2 py-1 text-left">睡眠</th>
              <td className="px-2 py-1">{content.functional_impact.sleep_impact}</td>
              <th className="w-1/6 bg-gray-100 px-2 py-1 text-left">認知</th>
              <td className="px-2 py-1">{content.functional_impact.cognition_impact}</td>
            </tr>
            <tr>
              <th className="bg-gray-100 px-2 py-1 text-left">食事口腔</th>
              <td className="px-2 py-1">{content.functional_impact.diet_impact}</td>
              <th className="bg-gray-100 px-2 py-1 text-left">歩行運動</th>
              <td className="px-2 py-1">{content.functional_impact.mobility_impact}</td>
            </tr>
            <tr>
              <th className="bg-gray-100 px-2 py-1 text-left">排泄</th>
              <td className="px-2 py-1">{content.functional_impact.excretion_impact}</td>
              <td colSpan={2} />
            </tr>
          </tbody>
        </table>
      </section>

      {/* 残薬状況 */}
      <section>
        <h2 className="mb-1 bg-gray-800 px-2 py-1 text-sm font-bold text-white">【残薬状況】</h2>
        <div className="border border-gray-400 px-3 py-2 text-xs">
          <p>{content.residual_status.summary}</p>
          {content.residual_status.reduction_proposals.length > 0 && (
            <ul className="mt-1 list-disc pl-4">
              {content.residual_status.reduction_proposals.map((p, i) => (
                <li key={i}>{p}</li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* 介護サービスとの連携事項 */}
      <section>
        <h2 className="mb-1 bg-gray-800 px-2 py-1 text-sm font-bold text-white">
          【介護サービスとの連携事項】
        </h2>
        <table className="w-full border border-gray-400 text-xs">
          <tbody>
            <tr>
              <th className="w-1/4 bg-gray-100 px-2 py-1 text-left">服薬介助</th>
              <td className="px-2 py-1">
                {content.care_service_coordination.medication_assistance}
              </td>
              <th className="w-1/4 bg-gray-100 px-2 py-1 text-left">一包化</th>
              <td className="px-2 py-1">
                {content.care_service_coordination.unit_dose_packaging ? '実施中' : '未実施'}
              </td>
            </tr>
            <tr>
              <th className="bg-gray-100 px-2 py-1 text-left">カレンダー推奨</th>
              <td className="px-2 py-1">
                {content.care_service_coordination.calendar_recommendation ? 'あり' : 'なし'}
              </td>
              <th className="bg-gray-100 px-2 py-1 text-left">その他</th>
              <td className="px-2 py-1">{content.care_service_coordination.other_items || '—'}</td>
            </tr>
          </tbody>
        </table>
      </section>

      {/* 今後の計画 */}
      <section>
        <h2 className="mb-1 bg-gray-800 px-2 py-1 text-sm font-bold text-white">【今後の計画】</h2>
        <div className="border border-gray-400 px-3 py-2 text-xs">
          {content.next_visit_plan.date && (
            <p className="mb-1">
              次回訪問予定: {new Date(content.next_visit_plan.date).toLocaleDateString('ja-JP')}
            </p>
          )}
          {content.next_visit_plan.followup_items.length > 0 && (
            <ul className="list-disc pl-4">
              {content.next_visit_plan.followup_items.map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* Footer */}
      <div className="mt-6 border-t pt-2 text-right text-xs">薬剤師: {content.pharmacist_name}</div>
    </div>
  );
}

function AudienceReportPrint({ content }: { content: AudienceReportContent }) {
  const reportDate = content.report_date
    ? new Date(content.report_date).toLocaleDateString('ja-JP')
    : '—';
  const visitDate = content.visit_date
    ? new Date(content.visit_date).toLocaleDateString('ja-JP')
    : '—';
  const title =
    content.report_audience === 'visiting_nurse'
      ? '訪問看護向け服薬情報共有'
      : content.report_audience === 'family'
        ? 'ご家族向け服薬情報共有'
        : '施設向け服薬介助申し送り';
  const sections = [
    ['今日の要点', content.summary],
    ['服薬状況', content.medication],
    ['残薬', content.residual],
    ['薬剤師の評価', content.evaluation],
    ['お願いしたいこと', content.requests],
  ] as const;

  return (
    <div className="space-y-4 text-sm">
      <h1 className="border-b-2 border-black pb-2 text-center text-xl font-bold">{title}</h1>
      <table className="w-full border border-gray-400 text-xs">
        <tbody>
          <tr>
            <th className="w-1/6 bg-gray-100 px-2 py-1 text-left">報告日</th>
            <td className="px-2 py-1">{reportDate}</td>
            <th className="w-1/6 bg-gray-100 px-2 py-1 text-left">訪問日</th>
            <td className="px-2 py-1">{visitDate}</td>
          </tr>
          <tr>
            <th className="bg-gray-100 px-2 py-1 text-left">患者名</th>
            <td className="px-2 py-1">{content.patient.name} 様</td>
            <th className="bg-gray-100 px-2 py-1 text-left">担当薬剤師</th>
            <td className="px-2 py-1">{content.pharmacist_name}</td>
          </tr>
        </tbody>
      </table>
      {sections.map(([sectionTitle, body]) => (
        <section key={sectionTitle}>
          <h2 className="mb-1 bg-gray-800 px-2 py-1 text-sm font-bold text-white">
            【{sectionTitle}】
          </h2>
          <div className="min-h-[60px] whitespace-pre-wrap border border-gray-400 px-3 py-2 text-xs">
            {body || '—'}
          </div>
        </section>
      ))}
      <div className="mt-6 border-t pt-2 text-right text-xs">薬剤師: {content.pharmacist_name}</div>
    </div>
  );
}

// ─── Print page ───────────────────────────────────────────────────────────────

export default function ReportPrintPage() {
  const params = useParams<{ id: string }>();
  const reportId = params.id;
  const orgId = useOrgId();
  const [auditRunId] = useState(() => `${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const [manualPrintError, setManualPrintError] = useState<string | null>(null);

  const printAuditQuery = useQuery<
    CareReportPrintAuditResponse<CareReportPrintAuditPrintableReport>
  >({
    queryKey: ['care-report-print-audit', orgId, reportId, auditRunId],
    queryFn: async () => {
      const res = await fetch(buildCareReportPrintAuditApiPath(reportId), {
        method: 'POST',
        headers: buildOrgJsonHeaders(orgId),
        body: JSON.stringify({ intent: 'preview_rendered' }),
      });
      if (res.status === 403) throw new Error('PRINT_FORBIDDEN');
      return readApiJson<CareReportPrintAuditResponse<CareReportPrintAuditPrintableReport>>(res, {
        fallbackMessage: '報告書の印刷監査を記録できませんでした',
        schema: careReportPrintAuditResponseSchema,
      });
    },
    enabled: !!orgId && !!reportId,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnMount: 'always',
    staleTime: 0,
  });
  const data = printAuditQuery.data?.data.report;
  const canRenderPrintBody = printAuditQuery.data?.data.audited === true && data?.id === reportId;
  const isPrintForbidden =
    printAuditQuery.isError &&
    printAuditQuery.error instanceof Error &&
    printAuditQuery.error.message === 'PRINT_FORBIDDEN';

  const recordPrintRequestedAudit = useCallback(async () => {
    const res = await fetch(buildCareReportPrintAuditApiPath(reportId), {
      method: 'POST',
      headers: buildOrgJsonHeaders(orgId),
      body: JSON.stringify({ intent: 'print_requested' }),
    });
    if (res.status === 403) {
      setManualPrintError('印刷権限がないため、再印刷できません。');
      return false;
    }
    try {
      const audit = await readApiJson<CareReportPrintAuditResponse>(res, {
        fallbackMessage: '印刷監査を記録できないため、再印刷できません。',
        schema: careReportPrintAuditResponseSchema,
      });
      if (audit.data.audited !== true || !audit.data.report || audit.data.report.id !== reportId) {
        setManualPrintError('印刷監査を記録できないため、再印刷できません。');
        return false;
      }
    } catch {
      setManualPrintError('印刷監査を記録できないため、再印刷できません。');
      return false;
    }
    return true;
  }, [orgId, reportId]);

  // Auto-print after authorized data loads
  useEffect(() => {
    if (!data || !canRenderPrintBody) return;
    const timer = setTimeout(() => {
      void (async () => {
        setManualPrintError(null);
        const audited = await recordPrintRequestedAudit();
        if (audited) window.print();
      })();
    }, 1000);
    return () => clearTimeout(timer);
  }, [canRenderPrintBody, data, recordPrintRequestedAudit]);

  const handleManualPrint = async () => {
    setManualPrintError(null);
    const audited = await recordPrintRequestedAudit();
    if (audited) window.print();
  };

  if (printAuditQuery.isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loading label="印刷監査を記録中..." />
      </div>
    );
  }

  if (isPrintForbidden) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <div
          role="alert"
          className="max-w-md space-y-2 rounded-md border border-border/70 bg-card p-4"
        >
          <h1 className="text-base font-semibold text-foreground">印刷権限がありません</h1>
          <p className="text-sm text-muted-foreground">
            他職種送付権限がないため、この報告書の印刷ビューは表示できません。
          </p>
        </div>
      </div>
    );
  }

  if (printAuditQuery.isError || !data || !canRenderPrintBody) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <div
          role="alert"
          className="max-w-md space-y-2 rounded-md border border-border/70 bg-card p-4"
        >
          <h1 className="text-base font-semibold text-foreground">
            印刷監査を記録できませんでした
          </h1>
          <p className="text-sm text-muted-foreground">
            監査記録を保存できないため、報告書の印刷ビューは表示できません。
          </p>
        </div>
      </div>
    );
  }

  return (
    <PrintLayout pharmacyName={data.pharmacy_name}>
      <PrintPageToolbar
        backHref={buildReportHref(reportId)}
        backLabel="報告書詳細へ戻る"
        title="報告書 印刷ビュー"
        description="A4印刷に最適化したレイアウトです。印刷前に内容を確認してください。"
        mainWorkflowSteps={['reports']}
        mainWorkflowDescription="印刷ビューでも、報告書工程の終点として現在地を固定表示します。"
        shortcuts={getReportPrintShortcutLinks(reportId)}
        onPrint={handleManualPrint}
      />
      {manualPrintError ? (
        <div
          role="alert"
          className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive print:hidden"
        >
          {manualPrintError}
        </div>
      ) : null}

      {data.report_type === 'physician_report' ? (
        <PhysicianReportPrint content={data.content as PhysicianReportContent} />
      ) : data.report_type === 'care_manager_report' ? (
        <CareManagerReportPrint content={data.content as CareManagerReportContent} />
      ) : (
        <AudienceReportPrint content={data.content as AudienceReportContent} />
      )}
    </PrintLayout>
  );
}
