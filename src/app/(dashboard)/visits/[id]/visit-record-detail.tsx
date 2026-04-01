'use client';

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation } from '@tanstack/react-query';
import { format, parseISO } from 'date-fns';
import { ja } from 'date-fns/locale';
import {
  MessageSquare,
  Eye,
  Brain,
  ClipboardList,
  User,
  CalendarCheck,
  FileDown,
  Clock,
  FileText,
  FileImage,
  Paperclip,
  MapPin,
} from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { OUTCOME_LABELS, OUTCOME_VARIANTS } from '@/lib/constants/visit';
import type { VisitGeoLog } from '@/lib/visit-location';

type ResidualMedication = {
  id: string;
  drug_name: string;
  drug_code: string | null;
  prescribed_quantity: number | null;
  remaining_quantity: number;
  excess_days: number | null;
  is_prohibited_reduction: boolean;
  is_reduction_target: boolean;
};

type VisitRecordFull = {
  id: string;
  schedule_id: string;
  patient_id: string;
  pharmacist_id: string;
  visit_date: string;
  outcome_status: string;
  soap_subjective: string | null;
  soap_objective: string | null;
  soap_assessment: string | null;
  soap_plan: string | null;
  receipt_person_name: string | null;
  receipt_person_relation: string | null;
  receipt_at: string | null;
  next_visit_suggestion_date: string | null;
  cancellation_reason: string | null;
  postpone_reason: string | null;
  revisit_reason: string | null;
  version: number;
  created_at: string;
  updated_at: string;
  pharmacist_name: string | null;
  last_modified_by_id: string | null;
  last_modified_by_name: string | null;
  attachments: Array<{
    file_id: string;
    file_name: string;
    mime_type: string;
    size_bytes: number;
    uploaded_at: string | null;
    kind: 'photo' | 'attachment';
  }>;
  visit_geo_log: VisitGeoLog | null;
  schedule: {
    id: string;
    case_id: string;
    site_id: string | null;
    pharmacist_id: string;
    visit_type: string;
    scheduled_date: string;
    recurrence_rule: string | null;
    time_window_start: string | null;
    time_window_end: string | null;
  } | null;
};


const relationLabel: Record<string, string> = {
  self: '本人',
  spouse: '配偶者',
  child: '子',
  parent: '親',
  sibling: '兄弟姉妹',
  other_family: 'その他家族',
  caregiver: '介護者',
  facility_staff: '施設職員',
  other: 'その他',
};

function SoapSection({
  icon: Icon,
  label,
  colorClass,
  content,
}: {
  icon: React.ElementType;
  label: string;
  colorClass: string;
  content: string | null;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Icon className={`size-4 ${colorClass}`} aria-hidden="true" />
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {content ? (
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">{content}</p>
        ) : (
          <p className="text-sm text-muted-foreground">記録なし</p>
        )}
      </CardContent>
    </Card>
  );
}

function formatFileSize(sizeBytes: number) {
  if (sizeBytes >= 1024 * 1024) {
    return `${(sizeBytes / (1024 * 1024)).toFixed(1)}MB`;
  }

  if (sizeBytes >= 1024) {
    return `${Math.round(sizeBytes / 1024)}KB`;
  }

  return `${sizeBytes}B`;
}

function formatTimeWindow(value: string | null) {
  if (!value) return undefined;

  try {
    return format(parseISO(value), 'HH:mm', { locale: ja });
  } catch {
    return undefined;
  }
}

function formatGeoCoordinate(value: number) {
  return value.toFixed(5);
}

function GeoLocationCard({
  label,
  point,
}: {
  label: string;
  point: { latitude: number; longitude: number; captured_at: string; accuracy_meters: number | null } | null;
}) {
  return (
    <div className="rounded-lg border border-border/70 px-3 py-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      {point ? (
        <>
          <p className="mt-1 text-sm font-medium">
            {formatGeoCoordinate(point.latitude)},{' '}
            {formatGeoCoordinate(point.longitude)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {format(parseISO(point.captured_at), 'yyyy/MM/dd HH:mm', {
              locale: ja,
            })}
            {point.accuracy_meters != null
              ? ` / 精度 ±${point.accuracy_meters}m`
              : ''}
          </p>
        </>
      ) : (
        <p className="mt-1 text-sm text-muted-foreground">未記録</p>
      )}
    </div>
  );
}

export function VisitRecordDetail({ recordId }: { recordId: string }) {
  const orgId = useOrgId();
  const isBootstrappingOrg = !orgId;
  const router = useRouter();
  const [showReportMenu, setShowReportMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowReportMenu(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const generateReportMutation = useMutation({
    mutationFn: async (report_type?: string) => {
      const body: Record<string, string> = { visit_record_id: recordId };
      if (report_type) body.report_type = report_type;
      const res = await fetch('/api/care-reports/generate-from-visit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-org-id': orgId },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.message ?? '報告書の生成に失敗しました');
      }
      return res.json() as Promise<{ data: Array<{ id: string }> }>;
    },
    onSuccess: (result) => {
      toast.success('報告書を生成しました');
      setShowReportMenu(false);
      const firstId = result.data?.[0]?.id;
      if (firstId) router.push(`/reports/${firstId}`);
    },
    onError: (err: Error) => {
      toast.error(err.message);
      setShowReportMenu(false);
    },
  });

  function handleGenerateReport(report_type?: string) {
    generateReportMutation.mutate(report_type);
  }

  const createNextVisitMutation = useMutation({
    mutationFn: async (payload: {
      case_id: string;
      site_id?: string;
      visit_type: string;
      scheduled_date: string;
      pharmacist_id: string;
      time_window_start?: string;
      time_window_end?: string;
      recurrence_rule?: string;
    }) => {
      const response = await fetch('/api/visit-schedules', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-org-id': orgId,
        },
        body: JSON.stringify(payload),
      });

      const json = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(json?.message ?? '次回訪問予定の作成に失敗しました');
      }

      return json as { id: string };
    },
    onSuccess: (schedule) => {
      toast.success('次回訪問予定を作成しました');
      router.push(`/schedules?selected=${schedule.id}`);
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const { data: record, isLoading } = useQuery<VisitRecordFull>({
    queryKey: ['visit-record', recordId, orgId],
    queryFn: async () => {
      const res = await fetch(`/api/visit-records/${recordId}`, {
        headers: { 'x-org-id': orgId },
      });
      if (!res.ok) throw new Error('訪問記録の取得に失敗しました');
      return res.json();
    },
    enabled: !!orgId && !!recordId,
  });

  // Residual medications query
  const { data: residuals } = useQuery<ResidualMedication[]>({
    queryKey: ['residual-medications', recordId, orgId],
    queryFn: async () => {
      const res = await fetch(`/api/residual-medications?visit_record_id=${recordId}`, {
        headers: { 'x-org-id': orgId },
      });
      if (!res.ok) return [];
      const json = await res.json();
      return json.data ?? [];
    },
    enabled: !!orgId && !!recordId,
  });

  if (isBootstrappingOrg || isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-sm text-muted-foreground">読み込み中...</p>
      </div>
    );
  }

  if (!record) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-sm text-muted-foreground">訪問記録が見つかりません</p>
      </div>
    );
  }

  const visitDateFormatted = format(parseISO(record.visit_date), 'yyyy年MM月dd日', { locale: ja });

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-foreground">{visitDateFormatted} 訪問記録</h1>
          <div className="mt-1 flex items-center gap-2">
            <Badge variant={OUTCOME_VARIANTS[record.outcome_status] ?? 'outline'}>
              {OUTCOME_LABELS[record.outcome_status] ?? record.outcome_status}
            </Badge>
            {record.schedule && (
              <span className="text-sm text-muted-foreground">
                {record.schedule.visit_type}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Link
            href={`/api/visit-records/${recordId}/pdf`}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonVariants({ variant: 'outline', size: 'sm', className: 'gap-1' })}
            aria-label="訪問記録 PDF を開く"
          >
            <FileDown className="size-3.5" aria-hidden="true" />
            PDF出力
          </Link>

          {/* Report generation dropdown */}
          <div className="relative" ref={menuRef}>
            <Button
              size="sm"
              className="gap-1"
              onClick={() => setShowReportMenu((v) => !v)}
              disabled={generateReportMutation.isPending}
              aria-haspopup="menu"
              aria-expanded={showReportMenu}
            >
              <FileText className="size-3.5" aria-hidden="true" />
              {generateReportMutation.isPending ? '生成中...' : '報告書生成'}
            </Button>
            {showReportMenu && (
              <div
                role="menu"
                className="absolute right-0 top-full z-20 mt-1 w-56 rounded-md border border-border bg-popover shadow-md"
              >
                <button
                  role="menuitem"
                  className="w-full px-3 py-2.5 text-left text-sm hover:bg-accent focus:bg-accent focus:outline-none"
                  onClick={() => handleGenerateReport('physician_report')}
                >
                  医師向け報告書を作成
                </button>
                <button
                  role="menuitem"
                  className="w-full px-3 py-2.5 text-left text-sm hover:bg-accent focus:bg-accent focus:outline-none"
                  onClick={() => handleGenerateReport('care_manager_report')}
                >
                  ケアマネ向け情報提供書を作成
                </button>
                <div className="border-t border-border" />
                <button
                  role="menuitem"
                  className="w-full px-3 py-2.5 text-left text-sm font-medium text-primary hover:bg-accent focus:bg-accent focus:outline-none"
                  onClick={() => handleGenerateReport()}
                >
                  自動判定（保険種別に応じて生成）
                </button>
              </div>
            )}
          </div>

        </div>
      </div>

      {/* Audit info (e-document authenticity) */}
      <div className="flex flex-wrap items-center gap-4 rounded-lg border border-border bg-muted/30 px-4 py-2.5 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <Clock className="size-3" aria-hidden="true" />
          作成: {format(parseISO(record.created_at), 'yyyy/MM/dd HH:mm', { locale: ja })}
        </span>
        <span className="flex items-center gap-1">
          <Clock className="size-3" aria-hidden="true" />
          最終更新: {format(parseISO(record.updated_at), 'yyyy/MM/dd HH:mm', { locale: ja })}
        </span>
        <span>バージョン: v{record.version}</span>
        <span>記録者: {record.pharmacist_name ?? record.pharmacist_id}</span>
        <span>
          最終更新者: {record.last_modified_by_name ?? record.last_modified_by_id ?? record.pharmacist_name ?? record.pharmacist_id}
        </span>
      </div>

      {/* Reason fields */}
      {record.cancellation_reason && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3">
          <p className="text-xs font-medium text-destructive">キャンセル理由</p>
          <p className="mt-1 text-sm">{record.cancellation_reason}</p>
        </div>
      )}
      {record.postpone_reason && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3">
          <p className="text-xs font-medium text-amber-700">延期理由</p>
          <p className="mt-1 text-sm">{record.postpone_reason}</p>
        </div>
      )}
      {record.revisit_reason && (
        <div className="rounded-lg border border-blue-300 bg-blue-50 p-3">
          <p className="text-xs font-medium text-blue-700">再訪理由</p>
          <p className="mt-1 text-sm">{record.revisit_reason}</p>
        </div>
      )}

      {/* SOAP — 2-column on tablet */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="space-y-4">
          <SoapSection
            icon={MessageSquare}
            label="S — 主観情報"
            colorClass="text-blue-500"
            content={record.soap_subjective}
          />
          <SoapSection
            icon={Eye}
            label="O — 客観情報"
            colorClass="text-green-500"
            content={record.soap_objective}
          />
        </div>
        <div className="space-y-4">
          <SoapSection
            icon={Brain}
            label="A — 薬学的評価"
            colorClass="text-purple-500"
            content={record.soap_assessment}
          />
          <SoapSection
            icon={ClipboardList}
            label="P — 計画・介入"
            colorClass="text-orange-500"
            content={record.soap_plan}
          />
        </div>
      </div>

      {/* Receipt record */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <User className="size-4 text-muted-foreground" aria-hidden="true" />
            受領記録
          </CardTitle>
        </CardHeader>
        <CardContent>
          {record.receipt_person_name ? (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm md:grid-cols-3">
              <div>
                <dt className="text-xs text-muted-foreground">受領者名</dt>
                <dd className="mt-0.5 font-medium">{record.receipt_person_name}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">続柄</dt>
                <dd className="mt-0.5">
                  {record.receipt_person_relation
                    ? (relationLabel[record.receipt_person_relation] ?? record.receipt_person_relation)
                    : '—'}
                </dd>
              </div>
              {record.receipt_at && (
                <div>
                  <dt className="text-xs text-muted-foreground">受領日時</dt>
                  <dd className="mt-0.5">
                    {format(parseISO(record.receipt_at), 'yyyy/MM/dd HH:mm', { locale: ja })}
                  </dd>
                </div>
              )}
            </dl>
          ) : (
            <p className="text-sm text-muted-foreground">受領記録なし</p>
          )}
        </CardContent>
      </Card>

      {record.visit_geo_log?.enabled && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <MapPin className="size-4 text-muted-foreground" aria-hidden="true" />
              訪問位置情報
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 md:grid-cols-2">
              <GeoLocationCard label="開始位置" point={record.visit_geo_log.start ?? null} />
              <GeoLocationCard label="終了位置" point={record.visit_geo_log.end ?? null} />
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              権限状態: {record.visit_geo_log.permission}
            </p>
          </CardContent>
        </Card>
      )}

      {/* Next visit suggestion */}
      {record.next_visit_suggestion_date && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <CalendarCheck className="size-4 text-muted-foreground" aria-hidden="true" />
              次回訪問提案
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm font-medium">
              {format(parseISO(record.next_visit_suggestion_date), 'yyyy年MM月dd日', {
                locale: ja,
              })}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                className="gap-1"
                disabled={!record.schedule || createNextVisitMutation.isPending}
                onClick={() => {
                  if (!record.schedule || !record.next_visit_suggestion_date) return;

                  createNextVisitMutation.mutate({
                    case_id: record.schedule.case_id,
                    site_id: record.schedule.site_id ?? undefined,
                    visit_type: record.schedule.visit_type,
                    scheduled_date: record.next_visit_suggestion_date,
                    pharmacist_id: record.schedule.pharmacist_id,
                    time_window_start:
                      formatTimeWindow(record.schedule.time_window_start) ?? undefined,
                    time_window_end:
                      formatTimeWindow(record.schedule.time_window_end) ?? undefined,
                    recurrence_rule: record.schedule.recurrence_rule ?? undefined,
                  });
                }}
              >
                <CalendarCheck className="size-3.5" aria-hidden="true" />
                {createNextVisitMutation.isPending ? '作成中...' : '提案日で予定作成'}
              </Button>
              <Link
                href="/schedules"
                className={buttonVariants({ variant: 'outline', size: 'sm' })}
              >
                手動調整
              </Link>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Paperclip className="size-4 text-muted-foreground" aria-hidden="true" />
            写真・添付
          </CardTitle>
        </CardHeader>
        <CardContent>
          {record.attachments.length > 0 ? (
            <ul className="space-y-2">
              {record.attachments.map((attachment) => {
                const Icon = attachment.kind === 'photo' ? FileImage : FileText;

                return (
                  <li
                    key={attachment.file_id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border px-3 py-2"
                  >
                    <div className="min-w-0 space-y-1">
                      <div className="flex items-center gap-2">
                        <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
                        <span className="truncate text-sm font-medium text-foreground">
                          {attachment.file_name}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                        <span>{attachment.mime_type}</span>
                        <span>{formatFileSize(attachment.size_bytes)}</span>
                        {attachment.uploaded_at ? (
                          <span>
                            {format(parseISO(attachment.uploaded_at), 'yyyy/MM/dd HH:mm', {
                              locale: ja,
                            })}
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <Link
                      href={`/api/files/${attachment.file_id}/download`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={buttonVariants({
                        variant: 'outline',
                        size: 'sm',
                        className: 'gap-1',
                      })}
                    >
                      <FileDown className="size-3.5" aria-hidden="true" />
                      開く
                    </Link>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">添付ファイルはありません</p>
          )}
        </CardContent>
      </Card>

      {/* Residual medications */}
      {residuals && residuals.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">残薬記録</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-auto rounded-md border border-border">
              <table className="w-full text-sm">
                <caption className="sr-only">残薬一覧</caption>
                <thead className="bg-muted/60">
                  <tr className="border-b border-border">
                    <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">薬剤名</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">処方量</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">残数</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">余剰日数</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">区分</th>
                  </tr>
                </thead>
                <tbody>
                  {residuals.map((med, i) => (
                    <tr
                      key={med.id}
                      className={`border-b border-border last:border-0 ${i % 2 === 1 ? 'bg-muted/20' : ''}`}
                    >
                      <td className="px-3 py-2">{med.drug_name}</td>
                      <td className="px-3 py-2 text-right text-muted-foreground">
                        {med.prescribed_quantity ?? '—'}
                      </td>
                      <td className="px-3 py-2 text-right">{med.remaining_quantity}</td>
                      <td className="px-3 py-2 text-right">
                        {med.excess_days !== null ? `${med.excess_days}日` : '—'}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-1">
                          {med.is_prohibited_reduction && (
                            <Badge variant="destructive" className="text-xs">減数禁止</Badge>
                          )}
                          {med.is_reduction_target && !med.is_prohibited_reduction && (
                            <Badge variant="outline" className="text-xs text-amber-600 border-amber-300">
                              減数対象
                            </Badge>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
