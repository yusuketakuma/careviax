'use client';

import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { format, parseISO, differenceInCalendarDays } from 'date-fns';
import { ja } from 'date-fns/locale';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Clock,
  FileText,
  MessageSquare,
  Pill,
  RefreshCw,
  User,
} from 'lucide-react';
import Link from 'next/link';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { buildOrgHeaders } from '@/lib/api/org-headers';
import { formatDisplayEntityLabel } from '@/lib/display-id/display-labels';
import { buildPatientHref } from '@/lib/patient/navigation';
import { buildPrescriptionIntakeApiPath } from '@/lib/prescriptions/api-paths';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DataTable } from '@/components/ui/data-table';
import { Skeleton } from '@/components/ui/loading';
import { ErrorState } from '@/components/ui/error-state';
import { Separator } from '@/components/ui/separator';
import { PageScaffold } from '@/components/layout/page-scaffold';
import { WorkflowPageHeader } from '@/components/features/workflow/workflow-page-header';
import { PageShortcutLinks } from '@/components/features/workflow/page-shortcut-links';
import { JahisSupplementalRecordsCard } from '@/components/features/prescriptions/jahis-supplemental-records-card';
import {
  normalizeJahisSupplementalRecords,
  type JahisSupplementalRecordDbView,
} from '@/lib/pharmacy/jahis-supplemental-records-view';
import { SOURCE_LABELS } from '../new/prescription-form.shared';
import {
  CYCLE_STATUS_CONFIG,
  type InquiryRecord,
  type PrescriptionLine,
} from '../prescription.shared';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PrescriberInstitutionRef = {
  id: string;
  name: string;
  institution_code: string | null;
  phone: string | null;
  fax: string | null;
};

type PrescriptionIntakeDetail = {
  id: string;
  display_id: string | null;
  cycle_id: string;
  source_type: string;
  prescribed_date: string;
  prescriber_name: string | null;
  prescriber_institution: string | null;
  prescriber_institution_id: string | null;
  prescriber_institution_ref: PrescriberInstitutionRef | null;
  prescription_expiry_date: string | null;
  original_document_url: string | null;
  refill_remaining_count: number | null;
  refill_next_dispense_date: string | null;
  split_dispense_total: number | null;
  split_dispense_current: number | null;
  split_next_dispense_date: string | null;
  created_at: string;
  jahis_supplemental_records: JahisSupplementalRecordDbView[];
  lines: PrescriptionLine[];
  cycle: {
    id: string;
    display_id: string | null;
    overall_status: string;
    patient_id: string;
    case_id: string;
    case_: {
      patient: {
        id: string;
        name: string;
        name_kana: string;
        birth_date: string | null;
        gender: string | null;
      };
    };
    inquiries: InquiryRecord[];
  };
};

const INQUIRY_RESULT_CONFIG: Record<
  string,
  { label: string; variant: 'default' | 'secondary' | 'outline' | 'destructive' }
> = {
  changed: { label: '処方変更', variant: 'secondary' },
  unchanged: { label: '変更なし', variant: 'outline' },
  pending: { label: '回答待ち', variant: 'destructive' },
};

const GENDER_LABELS: Record<string, string> = {
  male: '男性',
  female: '女性',
  other: 'その他',
};

const ROUTE_LABELS: Record<string, string> = {
  internal: '内服',
  external: '外用',
  injection: '注射',
  other: 'その他',
};

const METHOD_LABELS: Record<string, string> = {
  standard: '通常',
  unit_dose: '一包化',
  crushed: '粉砕',
  other: 'その他',
};

const prescriptionLineColumns: ColumnDef<PrescriptionLine>[] = [
  {
    accessorKey: 'line_number',
    header: '#',
    cell: ({ row }) => (
      <span className="text-xs text-muted-foreground tabular-nums">{row.original.line_number}</span>
    ),
  },
  {
    accessorKey: 'drug_name',
    header: '薬剤名',
    cell: ({ row }) => {
      const line = row.original;
      return (
        <div>
          <div>
            <span className="font-medium">{line.drug_name}</span>
            {line.drug_code && (
              <span className="ml-1 text-[11px] text-muted-foreground">{line.drug_code}</span>
            )}
          </div>
          {line.dosage_form && (
            <span className="text-xs text-muted-foreground">{line.dosage_form}</span>
          )}
          {line.packaging_instructions && (
            <p className="mt-0.5 text-xs text-state-confirm">
              包装指示: {line.packaging_instructions}
            </p>
          )}
          {line.notes && <p className="mt-0.5 text-xs text-muted-foreground">備考: {line.notes}</p>}
        </div>
      );
    },
  },
  {
    accessorKey: 'dose',
    header: '用量',
    cell: ({ row }) => <span className="tabular-nums">{row.original.dose}</span>,
  },
  {
    accessorKey: 'frequency',
    header: '用法',
  },
  {
    accessorKey: 'days',
    header: '日数',
    cell: ({ row }) => <span className="tabular-nums">{row.original.days}日</span>,
  },
  {
    accessorKey: 'route',
    header: '投与経路',
    meta: { mobileHidden: true },
    cell: ({ row }) => (
      <span className="text-muted-foreground">
        {row.original.route ? (ROUTE_LABELS[row.original.route] ?? row.original.route) : '—'}
      </span>
    ),
  },
  {
    accessorKey: 'dispensing_method',
    header: '調剤方法',
    meta: { mobileHidden: true },
    cell: ({ row }) => (
      <span className="text-muted-foreground">
        {row.original.dispensing_method
          ? (METHOD_LABELS[row.original.dispensing_method] ?? row.original.dispensing_method)
          : '—'}
      </span>
    ),
  },
  {
    id: 'generic_status',
    header: '後発品',
    meta: { mobileHidden: true },
    cell: ({ row }) => {
      const line = row.original;
      if (line.is_generic) {
        return (
          <Badge
            variant="outline"
            className="border-transparent bg-tag-info/10 text-tag-info text-[11px]"
          >
            後発
          </Badge>
        );
      }
      if (line.is_generic_name_prescription) {
        return (
          <Badge
            variant="outline"
            className="border-transparent bg-state-done/10 text-state-done text-[11px]"
          >
            一般名
          </Badge>
        );
      }
      return <span className="text-xs text-muted-foreground">先発</span>;
    },
  },
];

function PrescriptionDetailLoadingState() {
  return (
    <PageScaffold>
      <WorkflowPageHeader
        title="処方受付詳細"
        description="受付内容と調剤サイクルを確認します。"
        action={{
          href: '/prescriptions',
          label: '一覧へ戻る',
          icon: <ArrowLeft className="size-4" aria-hidden="true" />,
        }}
        mainWorkflowSteps={['prescriptions']}
        mainWorkflowDescription="処方受付の詳細画面でも、主業務フローのどこを見ているかを固定表示します。"
        childrenLabel="関連導線"
      />

      <div className="space-y-6" role="status" aria-label="処方受付詳細を読み込み中">
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border/70 bg-card/70 px-4 py-3">
          <Skeleton className="h-6 w-20 rounded-full" />
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-4 w-36" />
          <Skeleton className="h-4 w-28" />
        </div>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(18rem,1fr)]">
          <Card>
            <CardHeader>
              <Skeleton className="h-5 w-32" />
            </CardHeader>
            <CardContent className="space-y-3">
              {Array.from({ length: 4 }).map((_, index) => (
                <div key={index} className="grid gap-2 sm:grid-cols-[8rem_minmax(0,1fr)]">
                  <Skeleton className="h-3 w-20" />
                  <Skeleton className="h-4 w-full" />
                </div>
              ))}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <Skeleton className="h-5 w-28" />
            </CardHeader>
            <CardContent className="space-y-3">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-9 w-full rounded-md" />
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <Skeleton className="h-5 w-28" />
          </CardHeader>
          <CardContent className="space-y-2">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="grid gap-3 sm:grid-cols-[3rem_1.5fr_1fr_1fr]">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-full" />
              </div>
            ))}
          </CardContent>
        </Card>
        <span className="sr-only">処方受付詳細を読み込んでいます。</span>
      </div>
    </PageScaffold>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function PrescriptionDetailContent({ intakeId }: { intakeId: string }) {
  const orgId = useOrgId();
  const router = useRouter();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['prescription-intake-detail', orgId, intakeId],
    queryFn: async () => {
      const res = await fetch(buildPrescriptionIntakeApiPath(intakeId), {
        headers: buildOrgHeaders(orgId),
      });
      if (!res.ok) throw new Error('処方受付の取得に失敗しました');
      return res.json() as Promise<PrescriptionIntakeDetail>;
    },
    enabled: !!orgId,
  });

  if (error) {
    // 取得失敗は再読み込み導線つきの共有 ErrorState で出す（従来のインライン box + 戻るのみを置換）。
    return (
      <PageScaffold>
        <ErrorState
          variant="server"
          size="page"
          title="処方受付を取得できませんでした"
          description="通信状態を確認し、再読み込みしてください。"
          onRetry={() => void refetch()}
          retryLabel="再読み込み"
          secondaryAction={{ label: '戻る', onClick: () => router.back() }}
        />
      </PageScaffold>
    );
  }

  if (isLoading || !data) return <PrescriptionDetailLoadingState />;

  const patient = data.cycle.case_.patient;
  const patientHref = buildPatientHref(patient.id);
  const statusConfig = CYCLE_STATUS_CONFIG[data.cycle.overall_status] ?? {
    label: data.cycle.overall_status,
    variant: 'outline' as const,
  };
  const inquiries = data.cycle.inquiries;
  const expiryDate = data.prescription_expiry_date ? parseISO(data.prescription_expiry_date) : null;
  const daysUntilExpiry = expiryDate ? differenceInCalendarDays(expiryDate, new Date()) : null;
  const prescriptionDisplayLabel = formatDisplayEntityLabel(data);
  const cycleDisplayLabel = formatDisplayEntityLabel({
    id: data.cycle_id,
    display_id: data.cycle.display_id,
  });

  return (
    <PageScaffold>
      <WorkflowPageHeader
        title={`${patient.name} の処方受付`}
        description={`受付ID: ${prescriptionDisplayLabel} / サイクル: ${cycleDisplayLabel}`}
        action={{
          href: '/prescriptions',
          label: '一覧へ戻る',
          icon: <ArrowLeft className="size-4" aria-hidden="true" />,
        }}
        mainWorkflowSteps={['prescriptions']}
        mainWorkflowDescription="処方受付の詳細画面でも、主業務フローのどこを見ているかを固定表示します。"
        childrenLabel="関連導線"
      >
        <PageShortcutLinks
          links={[
            { href: patientHref, label: '患者詳細' },
            { href: '/dispense', label: '調剤キュー' },
            { href: '/prescriptions/new', label: '新規受付' },
          ]}
        />
      </WorkflowPageHeader>

      <div className="space-y-6">
        {/* ── ステータスサマリ ── 薬剤師が最初に見るべき情報 */}
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border/70 bg-card/70 px-4 py-3">
          <Badge
            variant={statusConfig.variant}
            className={`text-sm ${statusConfig.className ?? ''}`}
          >
            {statusConfig.label}
          </Badge>
          <Separator orientation="vertical" className="h-5" />
          <span className="text-sm text-muted-foreground">
            {SOURCE_LABELS[data.source_type] ?? data.source_type}
          </span>
          <Separator orientation="vertical" className="h-5" />
          <span className="text-sm">
            処方日: {format(parseISO(data.prescribed_date), 'yyyy/MM/dd (E)', { locale: ja })}
          </span>
          {expiryDate && (
            <>
              <Separator orientation="vertical" className="h-5" />
              <span
                className={`text-sm ${daysUntilExpiry != null && daysUntilExpiry < 0 ? 'font-medium text-state-blocked' : daysUntilExpiry != null && daysUntilExpiry <= 1 ? 'font-medium text-state-confirm' : 'text-muted-foreground'}`}
              >
                {daysUntilExpiry != null && daysUntilExpiry < 0 ? (
                  <>
                    <AlertTriangle className="mr-1 inline size-3.5" aria-hidden="true" />
                    期限切れ
                  </>
                ) : (
                  <>有効期限: {format(expiryDate, 'MM/dd')}</>
                )}
              </span>
            </>
          )}
          <span className="text-sm text-muted-foreground">
            登録: {format(parseISO(data.created_at), 'MM/dd HH:mm', { locale: ja })}
          </span>
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          {/* ── 左カラム: 処方情報 + 患者情報 ── */}
          <div className="space-y-6 lg:col-span-1">
            {/* 患者情報 */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <User className="size-4 text-muted-foreground" aria-hidden="true" />
                  患者情報
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div>
                  <Link href={patientHref} className="font-medium text-primary hover:underline">
                    {patient.name}
                  </Link>
                  <span className="ml-1 text-xs text-muted-foreground">({patient.name_kana})</span>
                </div>
                {patient.birth_date && (
                  <p className="text-muted-foreground">
                    生年月日: {format(parseISO(patient.birth_date), 'yyyy/MM/dd')}
                    {patient.gender ? ` / ${GENDER_LABELS[patient.gender] ?? patient.gender}` : ''}
                  </p>
                )}
              </CardContent>
            </Card>

            {/* 処方元情報 */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <FileText className="size-4 text-muted-foreground" aria-hidden="true" />
                  処方元
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div>
                  <p className="text-xs text-muted-foreground">処方医</p>
                  <p>{data.prescriber_name ?? '未入力'}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">医療機関</p>
                  <p>{data.prescriber_institution ?? '未入力'}</p>
                  {data.prescriber_institution_ref && (
                    <p className="text-xs text-muted-foreground">
                      {data.prescriber_institution_ref.institution_code &&
                        `機関コード: ${data.prescriber_institution_ref.institution_code}`}
                      {data.prescriber_institution_ref.phone &&
                        ` / TEL: ${data.prescriber_institution_ref.phone}`}
                      {data.prescriber_institution_ref.fax &&
                        ` / FAX: ${data.prescriber_institution_ref.fax}`}
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>

            <JahisSupplementalRecordsCard
              records={normalizeJahisSupplementalRecords(
                undefined,
                data.jahis_supplemental_records,
              )}
              description="QR由来のOTC薬、残薬、患者等記入、かかりつけ薬剤師などを処方受付に紐付けています。"
            />

            {/* リフィル / 分割調剤 */}
            {(data.source_type === 'refill' || data.split_dispense_total) && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-sm">
                    <RefreshCw className="size-4 text-muted-foreground" aria-hidden="true" />
                    {data.source_type === 'refill' ? 'リフィル情報' : '分割調剤情報'}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  {data.source_type === 'refill' && (
                    <>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">残回数</span>
                        <span className="font-medium">{data.refill_remaining_count ?? 0}回</span>
                      </div>
                      {data.refill_next_dispense_date && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">次回調剤予定</span>
                          <span>
                            {format(parseISO(data.refill_next_dispense_date), 'yyyy/MM/dd')}
                          </span>
                        </div>
                      )}
                    </>
                  )}
                  {data.split_dispense_total && (
                    <>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">進捗</span>
                        <span className="font-medium">
                          {data.split_dispense_current ?? '?'} / {data.split_dispense_total}回
                        </span>
                      </div>
                      {data.split_next_dispense_date && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">次回調剤予定</span>
                          <span>
                            {format(parseISO(data.split_next_dispense_date), 'yyyy/MM/dd')}
                          </span>
                        </div>
                      )}
                    </>
                  )}
                </CardContent>
              </Card>
            )}
          </div>

          {/* ── 右カラム: 処方明細 + 疑義照会 ── */}
          <div className="space-y-6 lg:col-span-2">
            {/* 処方明細テーブル — 薬剤師の主要作業領域 */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <Pill className="size-4 text-muted-foreground" aria-hidden="true" />
                  処方明細 ({data.lines.length}品目)
                </CardTitle>
              </CardHeader>
              <CardContent>
                {data.lines.length === 0 ? (
                  <p className="text-sm text-muted-foreground">明細行がありません。</p>
                ) : (
                  <DataTable
                    columns={prescriptionLineColumns}
                    data={data.lines}
                    getRowId={(line) => line.id}
                    caption="処方明細一覧"
                  />
                )}
              </CardContent>
            </Card>

            {/* 疑義照会 */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <MessageSquare className="size-4 text-muted-foreground" aria-hidden="true" />
                  疑義照会 ({inquiries.length}件)
                </CardTitle>
              </CardHeader>
              <CardContent>
                {inquiries.length === 0 ? (
                  <p className="text-sm text-muted-foreground">疑義照会はありません。</p>
                ) : (
                  <div className="space-y-3">
                    {inquiries.map((inq) => {
                      const resultConfig = inq.result
                        ? (INQUIRY_RESULT_CONFIG[inq.result] ?? {
                            label: inq.result,
                            variant: 'outline' as const,
                          })
                        : null;

                      return (
                        <div
                          key={inq.id}
                          className="rounded-lg border border-border/70 bg-muted/20 p-4 space-y-2"
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge variant="secondary" className="text-xs">
                              {inq.reason}
                            </Badge>
                            {resultConfig && (
                              <Badge variant={resultConfig.variant} className="text-xs">
                                {inq.resolved_at ? (
                                  <CheckCircle2 className="mr-1 inline size-3" aria-hidden="true" />
                                ) : (
                                  <Clock className="mr-1 inline size-3" aria-hidden="true" />
                                )}
                                {resultConfig.label}
                              </Badge>
                            )}
                            {inq.proposal_origin === 'pre_issuance' && (
                              <Badge
                                variant="outline"
                                className="text-xs border-transparent bg-tag-info/10 text-tag-info"
                              >
                                事前提案反映
                              </Badge>
                            )}
                            {inq.residual_adjustment && (
                              <Badge
                                variant="outline"
                                className="text-xs border-transparent bg-state-confirm/10 text-state-confirm"
                              >
                                残薬調整
                              </Badge>
                            )}
                            <span className="text-xs text-muted-foreground">
                              照会日:{' '}
                              {format(parseISO(inq.inquired_at), 'yyyy/MM/dd HH:mm', {
                                locale: ja,
                              })}
                            </span>
                            {inq.resolved_at && (
                              <span className="text-xs text-muted-foreground">
                                解決:{' '}
                                {format(parseISO(inq.resolved_at), 'yyyy/MM/dd HH:mm', {
                                  locale: ja,
                                })}
                              </span>
                            )}
                          </div>
                          <div className="text-sm">
                            <p className="text-xs text-muted-foreground">
                              照会先: {inq.inquiry_to_physician}
                            </p>
                            <p className="mt-1 whitespace-pre-wrap">{inq.inquiry_content}</p>
                          </div>
                          {inq.change_detail && (
                            <div className="rounded-md border-l-4 border-border/70 border-l-state-confirm bg-card px-3 py-2 text-sm">
                              <p className="text-xs font-medium text-state-confirm">変更内容:</p>
                              <p className="whitespace-pre-wrap text-state-confirm">
                                {inq.change_detail}
                              </p>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>

        {/* ── アクションバー ── */}
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border/70 bg-card/70 px-4 py-3">
          <Button variant="outline" size="sm" asChild>
            <Link href="/prescriptions">
              <ArrowLeft className="mr-1 size-4" aria-hidden="true" />
              一覧へ戻る
            </Link>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link href="/dispense">調剤キューへ</Link>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link href={patientHref}>患者詳細</Link>
          </Button>
        </div>
      </div>
    </PageScaffold>
  );
}
