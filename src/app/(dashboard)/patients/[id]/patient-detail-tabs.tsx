'use client';

import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { differenceInDays, differenceInYears, format } from 'date-fns';
import { ja } from 'date-fns/locale';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Loading } from '@/components/ui/loading';
import { EmptyState } from '@/components/ui/empty-state';
import { PageSection } from '@/components/layout/page-section';
import { VisitBriefCard } from '@/components/visit-brief/visit-brief-card';
import { CasesTab } from './cases-tab';
import { MedicationsContent } from './medications/medications-content';
import { PatientConditionsCard } from './patient-conditions-card';
import { PatientIntakeSummaryCard } from './patient-intake-summary-card';
import { PatientInsuranceCard } from './patient-insurance-card';
import { PatientMasterCard } from './patient-master-card';
import { PatientFacilityMultiVisitCard } from './patient-facility-multi-visit-card';
import { PatientPackagingCard } from './patient-packaging-card';
import { PatientLabsCard } from './patient-labs-card';
import { PatientWorkflowPreviewCard } from './patient-workflow-preview-card';
import { PatientRiskCard } from './patient-risk-card';
import { PatientReadinessCard } from './patient-readiness-card';
import { PatientVisitsPanel } from './patient-visits-panel';
import { PatientCommunicationsPanel } from './patient-communications-panel';
import { PatientDocumentsPanel } from './patient-documents-panel';
import { PatientTimelinePanel } from './patient-timeline-panel';
import { deriveStatusFromPatient, selectNextVisit } from './patient-detail-helpers';
import { PrescriptionHistoryContent } from './prescriptions/prescription-history-content';
import { VisitConstraintsCard } from './visit-constraints-card';
import { JahisSupplementalRecordsCard } from '@/components/features/prescriptions/jahis-supplemental-records-card';
import { normalizeJahisSupplementalRecords } from '@/lib/pharmacy/jahis-supplemental-records-view';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { getPatientCareQueryKeys, invalidateQueryKeys } from '@/lib/visits/query-invalidations';
import {
  CalendarPlus,
  CirclePause,
  Clock,
  ClipboardPlus,
  FileQuestion,
  FileWarning,
  Hospital,
  LogOut,
  PhoneOff,
  RefreshCw,
  Sparkles,
  Star,
  TriangleAlert,
  UserCheck,
} from 'lucide-react';
import { STATUS_ICON_CONFIG } from '@/lib/patient/status-icon';
import { toast } from 'sonner';
import type { PatientOverview } from './patient-detail.types';

interface PatientDetailTabsProps {
  patientId: string;
}

const PATIENT_DETAIL_TABS = [
  { value: 'basic', label: '基本情報', description: '患者マスタ、保険、リスク、訪問条件' },
  { value: 'cases', label: 'ケース', description: 'ケース進行、担当、紹介情報' },
  { value: 'prescriptions', label: '処方履歴', description: '前回比較と薬剤ライン差分' },
  { value: 'medications', label: '薬剤', description: '服薬一覧、残薬、管理状況' },
  { value: 'visits', label: '訪問', description: '予定、記録、月次実績' },
  { value: 'communications', label: '連携', description: '連絡キュー、課題、請求ブロッカー' },
  { value: 'documents', label: '文書', description: '計画書、共有、PDF 導線' },
  { value: 'timeline', label: 'タイムライン', description: '自己申告、共有、統合イベント' },
] as const;

type PatientDetailTabValue = (typeof PATIENT_DETAIL_TABS)[number]['value'];

export function PatientDetailInfoGroup({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <PageSection
      title={title}
      description={description}
      contentClassName="grid gap-4 lg:grid-cols-2"
    >
      {children}
    </PageSection>
  );
}

const STATUS_ICONS = {
  stable: UserCheck,
  new: Sparkles,
  first_visit_soon: CalendarPlus,
  attention: Star,
  urgent: TriangleAlert,
  overdue_visit: Clock,
  report_pending: FileWarning,
  medication_change: RefreshCw,
  hospitalized: Hospital,
  discharged: LogOut,
  no_contact: PhoneOff,
  paused: CirclePause,
};

export function PatientDetailTabs({ patientId }: PatientDetailTabsProps) {
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const requestedTab = searchParams.get('tab');
  const requestedTabValue = PATIENT_DETAIL_TABS.some((tab) => tab.value === requestedTab)
    ? (requestedTab as PatientDetailTabValue)
    : null;
  const activeTab = requestedTabValue ?? 'basic';
  const [selectedTab, setSelectedTab] = useState<PatientDetailTabValue>(activeTab);
  const [archiveDialogOpen, setArchiveDialogOpen] = useState(false);

  const handleTabChange = (value: string) => {
    const nextTab = PATIENT_DETAIL_TABS.some((tab) => tab.value === value)
      ? (value as PatientDetailTabValue)
      : 'basic';
    setSelectedTab(nextTab);
    const nextParams = new URLSearchParams(searchParams.toString());
    if (nextTab === 'basic') {
      nextParams.delete('tab');
    } else {
      nextParams.set('tab', nextTab);
    }
    const nextQuery = nextParams.toString();
    router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname, { scroll: false });
  };

  useEffect(() => {
    setSelectedTab(activeTab);
  }, [activeTab]);

  const {
    data: patient,
    isLoading,
    error,
  } = useQuery<PatientOverview>({
    queryKey: ['patient-overview', patientId, orgId],
    queryFn: async () => {
      const res = await fetch(`/api/patients/${patientId}/overview`, {
        headers: { 'x-org-id': orgId },
      });
      if (!res.ok) throw new Error('患者情報の取得に失敗しました');
      return res.json();
    },
    enabled: Boolean(orgId),
  });

  const restoreMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(`/api/patients/${patientId}/restore`, {
        method: 'PATCH',
        headers: { 'x-org-id': orgId },
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error((payload as { message?: string }).message ?? '患者の復元に失敗しました');
      }
      return payload;
    },
    onSuccess: async () => {
      toast.success('患者を復元しました');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['patient-overview', patientId, orgId] }),
        invalidateQueryKeys(queryClient, getPatientCareQueryKeys({ orgId, patientId })),
      ]);
    },
    onError: (restoreError) => {
      toast.error(
        restoreError instanceof Error ? restoreError.message : '患者の復元に失敗しました',
      );
    },
  });

  const archiveMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(`/api/patients/${patientId}/archive`, {
        method: 'PATCH',
        headers: { 'x-org-id': orgId },
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          (payload as { message?: string }).message ?? '患者のアーカイブに失敗しました',
        );
      }
      return payload;
    },
    onSuccess: async () => {
      toast.success('患者をアーカイブしました');
      setArchiveDialogOpen(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['patient-overview', patientId, orgId] }),
        invalidateQueryKeys(queryClient, getPatientCareQueryKeys({ orgId, patientId })),
      ]);
    },
    onError: (archiveError) => {
      toast.error(
        archiveError instanceof Error ? archiveError.message : '患者のアーカイブに失敗しました',
      );
    },
  });

  useEffect(() => {
    const hash = window.location.hash.slice(1);
    if (!hash) return;
    const frame = window.requestAnimationFrame(() => {
      document.getElementById(decodeURIComponent(hash))?.scrollIntoView({ block: 'start' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [patientId, selectedTab]);

  if (!orgId || isLoading) return <Loading />;
  if (error || !patient) {
    return (
      <EmptyState
        icon={FileQuestion}
        title="患者が見つかりません"
        description="指定された患者情報を取得できませんでした"
      />
    );
  }

  const primaryResidence = patient.residences.find((residence) => residence.is_primary) ?? null;
  const nextVisit = selectNextVisit(patient.visit_schedules);
  const age = differenceInYears(new Date(), new Date(patient.birth_date));
  const activeTabMeta =
    PATIENT_DETAIL_TABS.find((tab) => tab.value === selectedTab) ?? PATIENT_DETAIL_TABS[0];
  const activeCase =
    patient.cases.find((item) => item.status === 'active') ?? patient.cases[0] ?? null;
  const prescriptionIntakeHref = activeCase
    ? `/prescriptions/new?patient_id=${patient.id}&case_id=${activeCase.id}`
    : `/prescriptions/new?patient_id=${patient.id}`;
  const patientStatusKey = deriveStatusFromPatient(patient);
  const patientStatusConfig = STATUS_ICON_CONFIG[patientStatusKey];
  const PatientStatusIconComponent = STATUS_ICONS[patientStatusKey];

  return (
    <div className="space-y-6">
      {/* Archive banner */}
      {patient.archived_at && (
        <div className="flex items-center justify-between rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <span>
            <strong>アーカイブ中</strong> — この患者はアーカイブされています。閲覧のみ可能です。{' '}
            {format(new Date(patient.archived_at), 'yyyy/MM/dd HH:mm', { locale: ja })}
            {patient.archived_by_name ? ` / 実行者 ${patient.archived_by_name}` : null}
          </span>
          <Button
            variant="outline"
            size="sm"
            className="shrink-0 border-amber-400 bg-white text-amber-900 hover:bg-amber-100"
            onClick={() => restoreMutation.mutate()}
            disabled={restoreMutation.isPending}
          >
            {restoreMutation.isPending ? '復元中...' : '復元'}
          </Button>
        </div>
      )}
      {/* Patient header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">{patient.name}</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">{patient.name_kana}</p>
          {patient.allergy_info?.some((a) => a.severity === 'severe') && (
            <span className="mt-1 inline-flex items-center gap-1 rounded-full border border-destructive/40 bg-destructive/10 px-2 py-0.5 text-xs font-semibold text-destructive">
              <TriangleAlert className="size-3" aria-hidden="true" />
              重症アレルギーあり
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!patient.archived_at ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setArchiveDialogOpen(true)}
              disabled={archiveMutation.isPending}
            >
              {archiveMutation.isPending ? 'アーカイブ中...' : 'アーカイブ'}
            </Button>
          ) : null}
          <Link
            href={`/patients/${patient.id}/edit`}
            className={buttonVariants({ size: 'sm', variant: 'outline' })}
          >
            患者編集
          </Link>
          <Link href={prescriptionIntakeHref} className={buttonVariants({ size: 'sm' })}>
            <ClipboardPlus className="mr-1.5 size-4" aria-hidden="true" />
            処方受付
          </Link>
        </div>
      </div>

      {/* Summary band: key lab values */}
      {patient.lab_summary &&
        patient.lab_summary.length > 0 &&
        (() => {
          const KEY_ANALYTES = [
            { code: 'egfr', label: 'eGFR', unit: '' },
            { code: 'k', label: 'K', unit: 'mEq/L' },
            { code: 'crp', label: 'CRP', unit: '' },
            { code: 'hba1c', label: 'HbA1c', unit: '%' },
            { code: 'pt_inr', label: 'PT-INR', unit: '' },
            { code: 'alb', label: 'Alb', unit: 'g/dL' },
          ];
          const labByCode = new Map(patient.lab_summary.map((l) => [l.analyte_code, l]));
          const present = KEY_ANALYTES.map((a) => ({ ...a, obs: labByCode.get(a.code) })).filter(
            (a) => a.obs,
          );
          if (present.length === 0) return null;
          return (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-lg border border-border/60 bg-muted/20 px-3 py-2 text-xs">
              <span className="font-medium text-muted-foreground shrink-0">最新検査値</span>
              {present.map(({ code, label, unit, obs }) => {
                const staleDays = obs ? differenceInDays(new Date(), new Date(obs.measured_at)) : 0;
                const isStale = staleDays > 90;
                return (
                  <span key={code} className="flex items-center gap-1">
                    <span className="text-muted-foreground">{label}</span>
                    <span
                      className={`font-semibold ${obs?.abnormal_flag ? 'text-destructive' : 'text-foreground'}`}
                    >
                      {obs?.value_numeric}
                      {unit}
                    </span>
                    {isStale && (
                      <span className="rounded bg-amber-100 px-1 text-[10px] text-amber-700">
                        {staleDays}日前
                      </span>
                    )}
                  </span>
                );
              })}
            </div>
          );
        })()}

      <Tabs value={selectedTab} onValueChange={handleTabChange}>
        <div className="space-y-4">
          <div className="md:hidden">
            <VisitBriefCard
              brief={patient.visit_brief}
              title="患者サマリー"
              description="処方変更、調剤方法、他職種共有、未解決事項を1画面に要約しています。"
            />
          </div>
          <TabsList
            variant="line"
            activateOnFocus
            className="w-full overflow-x-auto"
            data-testid="patient-detail-tablist"
            aria-label="患者詳細タブ"
          >
            {PATIENT_DETAIL_TABS.map((tab) => (
              <TabsTrigger
                key={tab.value}
                value={tab.value}
                onClick={() => handleTabChange(tab.value)}
                data-testid={`patient-detail-tab-${tab.value}`}
              >
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        <div className="md:grid md:grid-cols-[320px_minmax(0,1fr)] md:items-start md:gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
          <aside className="hidden space-y-4 md:sticky md:top-6 md:block">
            <Card>
              <CardHeader className="pb-3">
                <h2 className="font-heading text-base leading-snug font-medium">患者ハブ</h2>
              </CardHeader>
              <CardContent className="space-y-4 text-sm">
                <div className="space-y-2">
                  <div className="flex items-start gap-2.5">
                    <div
                      className={`mt-0.5 shrink-0 rounded-full p-1.5 ${patientStatusConfig.color} ${patientStatusConfig.bg}`}
                      title={patientStatusConfig.label}
                    >
                      <PatientStatusIconComponent className="size-4" aria-hidden="true" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2">
                        <p className="font-medium text-foreground">{patient.name}</p>
                        <Badge
                          variant="outline"
                          className={`shrink-0 text-[10px] ${patientStatusConfig.color} border-current`}
                        >
                          {patientStatusConfig.label}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {patient.name_kana} / {age}歳 / {patient.gender}
                      </p>
                    </div>
                  </div>
                  <div className="rounded-lg border border-border/70 bg-muted/30 p-3">
                    <p className="text-xs text-muted-foreground">主住所</p>
                    <p className="mt-1 leading-5 text-foreground">
                      {primaryResidence?.address ?? '未登録'}
                    </p>
                    {primaryResidence?.unit_name ? (
                      <p className="mt-1 text-xs text-muted-foreground">
                        部屋番号 {primaryResidence.unit_name}
                      </p>
                    ) : null}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-lg border border-border/70 p-3">
                    <p className="text-muted-foreground">次回訪問</p>
                    <p className="mt-1 font-medium text-foreground">
                      {nextVisit
                        ? format(new Date(nextVisit.scheduled_date), 'M/d HH:mm', { locale: ja })
                        : '未設定'}
                    </p>
                  </div>
                  <div className="rounded-lg border border-border/70 p-3">
                    <p className="text-muted-foreground">リスク理由</p>
                    <p className="mt-1 font-medium text-foreground">
                      {patient.risk_summary?.reasons.length ?? 0}件
                    </p>
                  </div>
                  <div className="rounded-lg border border-border/70 p-3">
                    <p className="text-muted-foreground">未完了タスク</p>
                    <p className="mt-1 font-medium text-foreground">
                      {patient.summary_metrics.open_tasks_count}件
                    </p>
                  </div>
                  <div className="rounded-lg border border-border/70 p-3">
                    <p className="text-muted-foreground">ステータス</p>
                    <p
                      className={`mt-1 inline-flex items-center gap-1 font-medium ${patientStatusConfig.color}`}
                    >
                      <PatientStatusIconComponent className="size-3.5" aria-hidden="true" />
                      {patientStatusConfig.label}
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  {patient.medical_insurance_number ? (
                    <Badge variant="outline">医療保険</Badge>
                  ) : null}
                  {patient.care_insurance_number ? <Badge variant="outline">介護保険</Badge> : null}
                  {patient.billing_support_flag ? (
                    <Badge variant="secondary">請求支援</Badge>
                  ) : null}
                  {(patient.risk_summary?.pending_reports ?? 0) > 0 ? (
                    <Badge variant="destructive">
                      報告待ち {patient.risk_summary?.pending_reports}
                    </Badge>
                  ) : null}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <h2 className="font-heading text-base leading-snug font-medium">詳細セクション</h2>
              </CardHeader>
              <CardContent className="space-y-1.5">
                {PATIENT_DETAIL_TABS.map((tab) => {
                  const isActive = selectedTab === tab.value;
                  return (
                    <button
                      key={tab.value}
                      type="button"
                      aria-pressed={isActive}
                      onClick={() => handleTabChange(tab.value)}
                      className={`flex min-h-11 w-full items-start justify-between gap-3 rounded-xl border px-3 py-3 text-left transition-colors ${
                        isActive
                          ? 'border-primary/30 bg-primary/5 text-foreground'
                          : 'border-border/70 bg-background text-muted-foreground hover:bg-muted/50'
                      }`}
                    >
                      <span className="space-y-1">
                        <span className="block text-sm font-medium">{tab.label}</span>
                        <span className="block text-xs leading-5">{tab.description}</span>
                      </span>
                      {isActive ? <Badge variant="outline">表示中</Badge> : null}
                    </button>
                  );
                })}
              </CardContent>
            </Card>
          </aside>

          <div className="min-w-0 space-y-4">
            <div className="hidden rounded-2xl border border-border/70 bg-muted/20 px-4 py-3 md:block">
              <p className="text-sm font-medium text-foreground">{activeTabMeta.label}</p>
              <p className="mt-1 text-xs text-muted-foreground">{activeTabMeta.description}</p>
            </div>

            <div className="hidden md:block">
              <VisitBriefCard
                brief={patient.visit_brief}
                title="患者サマリー"
                description="処方変更、調剤方法、他職種共有、未解決事項を1画面に要約しています。"
              />
            </div>

            {/* 基本情報タブ */}
            <TabsContent value="basic">
              <div className="space-y-6">
                <PatientDetailInfoGroup
                  title="受付・ワークフロー"
                  description="新規依頼、訪問予定、報告、連携の進み具合をまとめて確認します。"
                >
                  <PatientWorkflowPreviewCard patientId={patient.id} />
                  <PatientIntakeSummaryCard patient={patient} />
                </PatientDetailInfoGroup>

                <PatientDetailInfoGroup
                  title="患者基本・保険"
                  description="患者マスタ、住所、連絡先、保険、請求支援の前提情報をまとめます。"
                >
                  <div id="patient-facility-section">
                    <PatientMasterCard patient={patient} orgId={orgId} />
                  </div>
                  <PatientInsuranceCard patientId={patient.id} orgId={orgId} />
                </PatientDetailInfoGroup>

                <PatientDetailInfoGroup
                  title="臨床・安全情報"
                  description="リスク、readiness、検査値、病名・課題、お薬手帳QR由来情報をまとめます。"
                >
                  <PatientRiskCard riskSummary={patient.risk_summary} />
                  <PatientReadinessCard patientId={patient.id} />
                  <PatientLabsCard patientId={patient.id} orgId={orgId} />
                  <PatientConditionsCard
                    patientId={patient.id}
                    orgId={orgId}
                    initialConditions={patient.conditions}
                  />
                  <JahisSupplementalRecordsCard
                    records={normalizeJahisSupplementalRecords(
                      undefined,
                      patient.jahis_supplemental_records,
                    )}
                    description="お薬手帳QR由来の手帳メモ、残薬、患者記入、かかりつけ薬剤師情報を患者単位で管理します。"
                    className="lg:col-span-2"
                    gridClassName="grid gap-3 md:grid-cols-2"
                  />
                </PatientDetailInfoGroup>

                <PatientDetailInfoGroup
                  title="訪問・配薬条件"
                  description="同時訪問グループ、配薬設定、訪問条件、連絡制約をまとめます。"
                >
                  <div className="lg:col-span-2">
                    <PatientFacilityMultiVisitCard patient={patient} />
                  </div>
                  <PatientPackagingCard patientId={patient.id} orgId={orgId} />
                  <div id="patient-visit-constraints-section">
                    <VisitConstraintsCard patientId={patient.id} orgId={orgId} />
                  </div>
                </PatientDetailInfoGroup>
              </div>
            </TabsContent>

            {/* ケースタブ */}
            <TabsContent value="cases">
              <CasesTab patient={patient} orgId={orgId} />
            </TabsContent>

            {/* 処方履歴タブ */}
            <TabsContent value="prescriptions">
              <PrescriptionHistoryContent />
            </TabsContent>

            {/* プレースホルダータブ群 */}
            <TabsContent value="medications">
              <MedicationsContent
                patientId={patient.id}
                patientName={patient.name}
                patientNameKana={patient.name_kana}
                birthDate={patient.birth_date}
                gender={patient.gender}
                allergyInfo={patient.allergy_info}
              />
            </TabsContent>
            <TabsContent value="visits">
              <PatientVisitsPanel
                patientId={patient.id}
                medicalInsuranceNumber={patient.medical_insurance_number}
                careInsuranceNumber={patient.care_insurance_number}
                enabled={selectedTab === 'visits'}
              />
            </TabsContent>
            <TabsContent value="communications">
              <div id="patient-care-team-section">
                <PatientCommunicationsPanel
                  patientId={patient.id}
                  cases={patient.cases}
                  enabled={selectedTab === 'communications'}
                />
              </div>
            </TabsContent>
            <TabsContent value="documents">
              <PatientDocumentsPanel
                patientId={patient.id}
                patientName={patient.name}
                cases={patient.cases}
                enabled={selectedTab === 'documents'}
              />
            </TabsContent>
            <TabsContent value="timeline">
              <PatientTimelinePanel patientId={patient.id} enabled={selectedTab === 'timeline'} />
            </TabsContent>
          </div>
        </div>
      </Tabs>

      <ConfirmDialog
        open={archiveDialogOpen}
        onOpenChange={setArchiveDialogOpen}
        title="患者をアーカイブしますか"
        description="アーカイブ後は患者詳細を閲覧のみで保持し、通常運用の対象から外します。必要なら後で復元できます。"
        confirmLabel="アーカイブする"
        onConfirm={() => archiveMutation.mutate()}
      />
    </div>
  );
}
