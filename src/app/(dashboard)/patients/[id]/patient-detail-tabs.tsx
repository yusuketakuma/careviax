'use client';

import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { differenceInYears, format } from 'date-fns';
import { ja } from 'date-fns/locale';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { PatientWorkspaceRail } from './patient-workspace-rail';
import { Card, CardContent } from '@/components/ui/card';
import { Button, buttonVariants } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Loading } from '@/components/ui/loading';
import { EmptyState } from '@/components/ui/empty-state';
import { PageSection } from '@/components/layout/page-section';
import { CasesTab } from './cases-tab';
import { PharmacistMemoTab } from './pharmacist-memo-tab';
import { ProcessTab } from './process-tab';
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
import { getCycleWorkspaceAction } from '@/lib/prescription/cycle-workspace';
import { PrescriptionHistoryContent } from './prescriptions/prescription-history-content';
import { VisitConstraintsCard } from './visit-constraints-card';
import { JahisSupplementalRecordsCard } from '@/components/features/prescriptions/jahis-supplemental-records-card';
import { normalizeJahisSupplementalRecords } from '@/lib/pharmacy/jahis-supplemental-records-view';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { getPatientCareQueryKeys, invalidateQueryKeys } from '@/lib/visits/query-invalidations';
import { todayUtcRange } from '@/lib/utils/date-boundary';
import { ClipboardPlus, FileQuestion, TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';
import type { PatientOverview } from './patient-detail.types';

interface PatientDetailTabsProps {
  patientId: string;
}

/** design/ v1.9 p0_08 のタブ構成(タブバーに表示する 7 つ) */
const PATIENT_DETAIL_TABS = [
  { value: 'memo', label: '薬剤師メモ', description: '今日の見どころ、処方の変化、セットの注意' },
  { value: 'process', label: '工程', description: '9 工程の進行と次にやること' },
  { value: 'prescriptions', label: '処方・監査', description: '前回比較と薬剤ライン差分' },
  { value: 'medications', label: 'セット', description: '服薬一覧、残薬、セット方法' },
  { value: 'visits', label: '訪問', description: '予定、記録、月次実績' },
  { value: 'communications', label: '報告', description: '連絡キュー、課題、報告の進み具合' },
  { value: 'timeline', label: '履歴', description: '自己申告、共有、統合イベント' },
] as const;

/** タブバーには出さないが URL(?tab=)直アクセスで開ける既存タブ */
const HIDDEN_PATIENT_DETAIL_TABS = [
  { value: 'basic', label: '基本情報', description: '患者マスタ、保険、リスク、訪問条件' },
  { value: 'cases', label: 'ケース', description: 'ケース進行、担当、紹介情報' },
  { value: 'documents', label: '文書', description: '計画書、共有、PDF 導線' },
] as const;

const ALL_PATIENT_DETAIL_TABS = [...PATIENT_DETAIL_TABS, ...HIDDEN_PATIENT_DETAIL_TABS];

type PatientDetailTabValue = (typeof ALL_PATIENT_DETAIL_TABS)[number]['value'];

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

export function PatientDetailTabs({ patientId }: PatientDetailTabsProps) {
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const requestedTab = searchParams.get('tab');
  const requestedTabValue = ALL_PATIENT_DETAIL_TABS.some((tab) => tab.value === requestedTab)
    ? (requestedTab as PatientDetailTabValue)
    : null;
  const activeTab = requestedTabValue ?? 'memo';
  const [selectedTabState, setSelectedTabState] = useState<{
    sourceTab: PatientDetailTabValue;
    selectedTab: PatientDetailTabValue;
  }>({ sourceTab: activeTab, selectedTab: activeTab });
  const selectedTab =
    selectedTabState.sourceTab === activeTab ? selectedTabState.selectedTab : activeTab;
  const [archiveDialogOpen, setArchiveDialogOpen] = useState(false);

  const handleTabChange = (value: string) => {
    const nextTab = ALL_PATIENT_DETAIL_TABS.some((tab) => tab.value === value)
      ? (value as PatientDetailTabValue)
      : 'memo';
    setSelectedTabState({ sourceTab: activeTab, selectedTab: nextTab });
    const nextParams = new URLSearchParams(searchParams.toString());
    // タブ操作中は profile ビューに留まる(?view/?tab なしの /patients/[id] はカード作業台)
    nextParams.set('view', 'profile');
    if (nextTab === 'memo') {
      nextParams.delete('tab');
    } else {
      nextParams.set('tab', nextTab);
    }
    const nextQuery = nextParams.toString();
    router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname, { scroll: false });
  };

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
  const age = differenceInYears(new Date(), new Date(patient.birth_date));
  const activeCase =
    patient.cases.find((item) => item.status === 'active') ?? patient.cases[0] ?? null;
  const prescriptionIntakeHref = activeCase
    ? `/prescriptions/new?patient_id=${patient.id}&case_id=${activeCase.id}`
    : `/prescriptions/new?patient_id=${patient.id}`;

  // 左ミニカード: 直近の「予定」と、その次の「次回訪問」
  const startOfToday = todayUtcRange().gte;
  const upcomingVisits = patient.visit_schedules
    .filter(
      (visit) =>
        ['planned', 'in_preparation', 'ready', 'departed', 'in_progress'].includes(
          visit.schedule_status,
        ) && new Date(visit.scheduled_date) >= startOfToday,
    )
    .sort((a, b) => +new Date(a.scheduled_date) - +new Date(b.scheduled_date));
  const nextVisit = upcomingVisits[0] ?? null;
  const followingVisit = upcomingVisits[1] ?? null;
  const workspace = patient.workspace;
  const workspaceAction = workspace ? getCycleWorkspaceAction(workspace.overall_status) : null;
  const residenceLabel = primaryResidence ? (primaryResidence.facility_id ? '施設' : '自宅') : null;
  const genderLabel =
    patient.gender === 'male' ? '男性' : patient.gender === 'female' ? '女性' : 'その他';
  const formatMonthDay = (value: string | null | undefined) =>
    value ? format(new Date(value), 'M/d', { locale: ja }) : null;
  const nextVisitTimeLabel = nextVisit
    ? `${format(new Date(nextVisit.scheduled_date), 'M/d', { locale: ja })}${
        nextVisit.time_window_start
          ? ` ${format(new Date(nextVisit.time_window_start), 'HH:mm')}`
          : ''
      }`
    : null;

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
      <Tabs value={selectedTab} onValueChange={handleTabChange}>
        <div className="space-y-4">
          <TabsList
            variant="line"
            activateOnFocus
            className="w-full justify-start gap-6 overflow-x-auto"
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

        {/* 右レール(300px)は 2xl 以上のみ 3 カラム化する。xl(1280)〜1535px で 3 カラムにすると
            中央カラムが約 360px まで潰れ、受付票 DetailBlock の値(dd)が幅 0 になるため。 */}
        <div className="md:grid md:grid-cols-[280px_minmax(0,1fr)] md:items-start md:gap-6 2xl:grid-cols-[260px_minmax(0,1fr)_300px]">
          {/* モバイルでは縦積みでサマリーを先頭に出す(ガイドライン: 順序を変えず縦積み)。md 以上は左固定カラム */}
          <aside className="space-y-4 md:sticky md:top-6">
            <Card data-testid="patient-mini-card">
              <CardContent className="flex flex-col gap-4 pt-6 text-sm">
                <div>
                  <p className="text-lg font-bold leading-snug text-foreground">
                    {patient.name} 様
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {age}歳 / {genderLabel}
                    {residenceLabel ? ` / ${residenceLabel}` : ''}
                  </p>
                  {patient.allergy_info?.some((a) => a.severity === 'severe') && (
                    <span className="mt-2 inline-flex items-center gap-1 rounded-full border border-destructive/40 bg-destructive/10 px-2 py-0.5 text-xs font-semibold text-destructive">
                      <TriangleAlert className="size-3" aria-hidden="true" />
                      重症アレルギーあり
                    </span>
                  )}
                </div>

                <dl className="space-y-2.5">
                  <div className="flex items-baseline justify-between gap-2">
                    <dt className="shrink-0 text-xs text-muted-foreground">予定</dt>
                    <dd className="text-right font-medium text-foreground">
                      {nextVisitTimeLabel ?? '未設定'}
                      {nextVisit?.confirmed_at ? (
                        <span className="ml-1.5 text-xs font-semibold text-primary">正式決定</span>
                      ) : nextVisit ? (
                        <span className="ml-1.5 text-xs text-muted-foreground">調整中</span>
                      ) : null}
                    </dd>
                  </div>
                  <div className="flex items-baseline justify-between gap-2">
                    <dt className="shrink-0 text-xs text-muted-foreground">前回薬</dt>
                    <dd className="text-right font-medium text-foreground">
                      {workspace?.previous_medication?.end
                        ? `${formatMonthDay(workspace.previous_medication.end)}まで`
                        : '—'}
                    </dd>
                  </div>
                  <div className="flex items-baseline justify-between gap-2">
                    <dt className="shrink-0 text-xs text-muted-foreground">今回薬</dt>
                    <dd className="text-right font-medium text-foreground">
                      {workspace?.current_medication?.start && workspace?.current_medication?.end
                        ? `${formatMonthDay(workspace.current_medication.start)}〜${formatMonthDay(workspace.current_medication.end)}`
                        : '—'}
                    </dd>
                  </div>
                  <div className="flex items-baseline justify-between gap-2">
                    <dt className="shrink-0 text-xs text-muted-foreground">次回訪問</dt>
                    <dd className="text-right font-medium text-foreground">
                      {followingVisit ? formatMonthDay(followingVisit.scheduled_date) : '—'}
                    </dd>
                  </div>
                  <div className="flex items-baseline justify-between gap-2 border-t border-border/60 pt-2.5">
                    <dt className="shrink-0 text-xs text-muted-foreground">現在</dt>
                    <dd className="text-right font-semibold text-foreground">
                      {workspaceAction?.statusLabel ?? '進行中サイクルなし'}
                    </dd>
                  </div>
                </dl>

                <div className="flex flex-col gap-2 pt-1">
                  <Link
                    href={`/patients/${patient.id}/edit`}
                    className={buttonVariants({ className: 'min-h-11 w-full' })}
                  >
                    カードを編集
                  </Link>
                  <Link
                    href="/patients"
                    className={buttonVariants({ variant: 'outline', className: 'min-h-11 w-full' })}
                  >
                    一覧へ戻る
                  </Link>
                </div>

                <div className="flex flex-wrap gap-2 border-t border-border/60 pt-3">
                  <Link
                    href={prescriptionIntakeHref}
                    className={buttonVariants({ variant: 'ghost', size: 'sm' })}
                  >
                    <ClipboardPlus className="mr-1 size-3.5" aria-hidden="true" />
                    処方受付
                  </Link>
                  {!patient.archived_at ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="text-muted-foreground"
                      onClick={() => setArchiveDialogOpen(true)}
                      disabled={archiveMutation.isPending}
                    >
                      {archiveMutation.isPending ? 'アーカイブ中...' : 'アーカイブ'}
                    </Button>
                  ) : null}
                </div>
              </CardContent>
            </Card>
          </aside>

          <div className="min-w-0 space-y-4">
            {/* 薬剤師メモタブ(既定) */}
            <TabsContent value="memo">
              <PharmacistMemoTab brief={patient.visit_brief} workspace={workspace} />
            </TabsContent>

            {/* 工程タブ */}
            <TabsContent value="process">
              <ProcessTab workspace={workspace} />
            </TabsContent>

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

          <aside
            className="hidden 2xl:sticky 2xl:top-6 2xl:block"
            aria-label="次にやること・止まっている理由・根拠"
          >
            <PatientWorkspaceRail
              patientId={patient.id}
              brief={patient.visit_brief}
              workspace={workspace}
              onNavigateTab={handleTabChange}
            />
          </aside>
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
