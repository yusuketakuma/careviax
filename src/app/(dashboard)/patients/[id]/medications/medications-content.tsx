'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type ColumnDef } from '@tanstack/react-table';
import { differenceInCalendarDays, format, parseISO } from 'date-fns';
import { ja } from 'date-fns/locale';
import {
  CheckCircle2,
  ClipboardPlus,
  Edit3,
  Pill,
  Plus,
  Printer,
  QrCode,
  RefreshCw,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { Card, CardAction, CardContent, CardDescription, CardHeader } from '@/components/ui/card';
import { DataTable } from '@/components/ui/data-table';
import { HelpPopover } from '@/components/ui/help-popover';
import { SkeletonRows } from '@/components/ui/loading';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { ResidualMedicationChart } from '@/components/features/patients/residual-medication-chart';
import { readApiJson } from '@/lib/api/client-json';
import { buildOrgHeaders, buildOrgJsonHeaders } from '@/lib/api/org-headers';
import { encodePathSegment } from '@/lib/http/path-segment';
import { buildPatientApiPath } from '@/lib/patient/api-paths';
import { buildPatientHref } from '@/lib/patient/navigation';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { getPatientCareQueryKeys, invalidateQueryKeys } from '@/lib/visits/query-invalidations';
import { buildJahisQRText, type JahisPatient } from '@/lib/pharmacy/jahis-qr';
import { formatDateTimeLabel } from '@/lib/ui/date-format';
import { toast } from 'sonner';
import { messageFromError } from '@/lib/utils/error-message';

type MedicationProfile = {
  id: string;
  patient_id: string;
  drug_name: string;
  dose: string | null;
  frequency: string | null;
  start_date: string | null;
  end_date: string | null;
  prescriber: string | null;
  is_current: boolean;
  source: string | null;
  created_at: string;
};

type MedicationIssue = {
  id: string;
  patient_id: string;
  case_id: string | null;
  title: string;
  description: string;
  status: 'open' | 'in_progress' | 'resolved' | 'dismissed';
  priority: 'critical' | 'high' | 'medium' | 'low';
  category: 'adherence' | 'side_effect' | 'interaction' | 'duplicate' | 'other' | null;
  identified_at: string;
  resolved_at?: string | null;
};

type ResidualMedication = {
  id: string;
  visit_record_id: string;
  drug_name: string;
  drug_code: string | null;
  prescribed_quantity: number | null;
  remaining_quantity: number;
  excess_days: number | null;
  is_reduction_target: boolean;
  is_prohibited_reduction: boolean;
  created_at: string;
};

type InquiryRecord = {
  id: string;
  reason: string;
  inquiry_to_physician: string;
  inquiry_content: string;
  result: 'changed' | 'unchanged' | 'pending' | null;
  proposal_origin: 'post_inquiry' | 'pre_issuance' | null;
  residual_adjustment: boolean | null;
  change_detail: string | null;
  inquired_at: string;
  resolved_at: string | null;
  line: {
    drug_name: string | null;
    line_number: number | null;
  } | null;
};

type IssueFormData = {
  title: string;
  description: string;
  priority: MedicationIssue['priority'];
  category: NonNullable<MedicationIssue['category']>;
  status: MedicationIssue['status'];
};

type QrExportState = {
  dataUrl: string;
  payload: string;
  generatedAt: string;
};

type MedicationsContentProps = {
  patientId: string;
  patientName?: string;
  patientNameKana?: string;
  birthDate?: string;
  gender?: string;
  allergyInfo?: Array<{ drug_name: string; category: string; severity: string } | string> | null;
};

const sourceLabel: Record<string, string> = {
  qr_scan: 'QRスキャン',
  manual: '手動入力',
  prescription: '処方箋',
};

const timingRules = [
  { label: '朝', pattern: /朝/ },
  { label: '昼', pattern: /昼/ },
  { label: '夕', pattern: /夕/ },
  { label: '就寝前', pattern: /寝|就寝/ },
  { label: '頓服', pattern: /頓服|必要時/ },
  { label: '外用', pattern: /外用|貼付|点眼|塗布/ },
] as const;

const issueCategoryLabel: Record<NonNullable<MedicationIssue['category']>, string> = {
  adherence: '服薬アドヒアランス',
  side_effect: '副作用',
  interaction: '相互作用',
  duplicate: '重複投与',
  other: 'その他',
};

const issuePriorityLabel: Record<MedicationIssue['priority'], string> = {
  critical: '緊急',
  high: '高',
  medium: '中',
  low: '低',
};

const issueStatusLabel: Record<MedicationIssue['status'], string> = {
  open: '未対応',
  in_progress: '対応中',
  resolved: '解決',
  dismissed: '却下',
};

const clinicalActionSizeClass = 'h-auto min-h-[44px] sm:h-auto sm:min-h-[44px]';

function formatMedicationDate(value: string | null) {
  if (!value) return '—';
  return format(parseISO(value), 'yyyy/MM/dd', { locale: ja });
}

function extractTimingTags(frequency: string | null) {
  if (!frequency) return [];
  return timingRules.filter((rule) => rule.pattern.test(frequency)).map((rule) => rule.label);
}

function buildMedicationStats(profiles: MedicationProfile[]) {
  const today = new Date();
  const activePrescribers = new Set(
    profiles.map((item) => item.prescriber).filter((value): value is string => Boolean(value)),
  );
  const recentlyStarted = profiles.filter((item) => {
    if (!item.start_date) return false;
    return differenceInCalendarDays(today, parseISO(item.start_date)) <= 30;
  }).length;
  const endingSoon = profiles.filter((item) => {
    if (!item.end_date) return false;
    const days = differenceInCalendarDays(parseISO(item.end_date), today);
    return days >= 0 && days <= 14;
  }).length;

  return [
    {
      label: '服薬中薬剤',
      value: `${profiles.length}剤`,
      description: '訪問時に確認する現行処方です。',
    },
    {
      label: '処方医',
      value: `${activePrescribers.size}名`,
      description: '処方元の把握に使います。',
    },
    {
      label: '新しく始まった薬',
      value: `${recentlyStarted}剤`,
      description: '過去30日以内に開始された薬剤です。',
    },
    {
      label: '終了予定が近い薬',
      value: `${endingSoon}剤`,
      description: '14日以内に終了日が来る薬剤です。',
    },
  ];
}

function normalizePatientGender(gender: string): JahisPatient['gender'] {
  if (gender === 'male' || gender === '男性') return 'male';
  if (gender === 'female' || gender === '女性') return 'female';
  return 'other';
}

function getIssueBadgeVariant(
  issue: MedicationIssue,
): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (issue.priority === 'critical') return 'destructive';
  if (issue.status === 'resolved') return 'secondary';
  if (issue.status === 'in_progress') return 'default';
  return 'outline';
}

const columns: ColumnDef<MedicationProfile>[] = [
  {
    accessorKey: 'drug_name',
    header: '薬剤名',
    cell: ({ row }) => <span className="font-medium">{row.original.drug_name}</span>,
  },
  {
    accessorKey: 'dose',
    header: '用量',
    cell: ({ row }) => <span className="text-sm">{row.original.dose ?? '—'}</span>,
  },
  {
    accessorKey: 'frequency',
    header: '用法',
    cell: ({ row }) => <span className="text-sm">{row.original.frequency ?? '—'}</span>,
  },
  {
    accessorKey: 'start_date',
    header: '開始日',
    cell: ({ row }) =>
      row.original.start_date ? (
        <span className="text-sm">
          {format(parseISO(row.original.start_date), 'yyyy/MM/dd', { locale: ja })}
        </span>
      ) : (
        <span className="text-sm text-muted-foreground">—</span>
      ),
  },
  {
    accessorKey: 'is_current',
    header: '状態',
    cell: ({ row }) => (
      <Badge variant={row.original.is_current ? 'default' : 'secondary'}>
        {row.original.is_current ? '服薬中' : '終了'}
      </Badge>
    ),
  },
  {
    accessorKey: 'source',
    header: '登録方法',
    cell: ({ row }) => (
      <span className="text-sm text-muted-foreground">
        {row.original.source ? (sourceLabel[row.original.source] ?? row.original.source) : '—'}
      </span>
    ),
  },
];

type AddMedicationFormData = {
  drug_name: string;
  dose: string;
  frequency: string;
  prescriber: string;
};

function AddMedicationDialog({ patientId, onClose }: { patientId: string; onClose: () => void }) {
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<AddMedicationFormData>({
    drug_name: '',
    dose: '',
    frequency: '',
    prescriber: '',
  });

  const mutation = useMutation({
    mutationFn: async (data: AddMedicationFormData) => {
      const res = await fetch('/api/medication-profiles', {
        method: 'POST',
        headers: buildOrgJsonHeaders(orgId),
        body: JSON.stringify({
          patient_id: patientId,
          drug_name: data.drug_name,
          dose: data.dose || undefined,
          frequency: data.frequency || undefined,
          prescriber: data.prescriber || undefined,
          source: 'manual',
        }),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok) throw new Error(payload?.message ?? '登録に失敗しました');
      return payload;
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['medication-profiles', orgId, patientId] }),
        invalidateQueryKeys(queryClient, getPatientCareQueryKeys({ orgId, patientId })),
      ]);
      onClose();
    },
  });

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!form.drug_name) return;
    mutation.mutate(form);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-md rounded-lg bg-background p-6 shadow-lg">
        <h2 className="mb-4 text-lg font-semibold">薬剤追加</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="drug_name">薬剤名 *</Label>
            <Input
              id="drug_name"
              value={form.drug_name}
              onChange={(event) =>
                setForm((current) => ({ ...current, drug_name: event.target.value }))
              }
              placeholder="例: アムロジピン錠5mg"
              required
              className="mt-1"
            />
          </div>
          <div>
            <Label htmlFor="dose">用量</Label>
            <Input
              id="dose"
              value={form.dose}
              onChange={(event) => setForm((current) => ({ ...current, dose: event.target.value }))}
              placeholder="例: 1錠"
              className="mt-1"
            />
          </div>
          <div>
            <Label htmlFor="frequency">用法</Label>
            <Input
              id="frequency"
              value={form.frequency}
              onChange={(event) =>
                setForm((current) => ({ ...current, frequency: event.target.value }))
              }
              placeholder="例: 1日1回朝食後"
              className="mt-1"
            />
          </div>
          <div>
            <Label htmlFor="prescriber">処方医</Label>
            <Input
              id="prescriber"
              value={form.prescriber}
              onChange={(event) =>
                setForm((current) => ({ ...current, prescriber: event.target.value }))
              }
              placeholder="例: 田中医師"
              className="mt-1"
            />
          </div>
          {mutation.isError ? (
            <p role="alert" aria-live="assertive" className="text-sm text-destructive">
              {messageFromError(mutation.error, '登録に失敗しました')}
            </p>
          ) : null}
          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" onClick={onClose}>
              キャンセル
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? '登録中...' : '登録'}
            </Button>
          </DialogFooter>
        </form>
      </div>
    </div>
  );
}

function IssueEditorDialog({
  issue,
  open,
  onOpenChange,
  onSubmit,
  isPending,
}: {
  issue: MedicationIssue | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (form: IssueFormData) => void;
  isPending: boolean;
}) {
  const [form, setForm] = useState<IssueFormData>({
    title: issue?.title ?? '',
    description: issue?.description ?? '',
    priority: issue?.priority ?? 'medium',
    category: issue?.category ?? 'other',
    status: issue?.status ?? 'open',
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{issue ? '薬学的課題を更新' : '薬学的課題を登録'}</DialogTitle>
          <DialogDescription>
            患者の服薬課題を記録し、疑義照会や次回訪問準備に引き継ぎます。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="issue-title">タイトル</Label>
            <Input
              id="issue-title"
              value={form.title}
              onChange={(event) =>
                setForm((current) => ({ ...current, title: event.target.value }))
              }
              placeholder="例: 夕食後薬の飲み忘れが継続"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="issue-description">内容</Label>
            <Textarea
              id="issue-description"
              value={form.description}
              onChange={(event) =>
                setForm((current) => ({ ...current, description: event.target.value }))
              }
              placeholder="現状、背景、次回確認したいことを記録します"
              rows={5}
            />
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="issue-priority">優先度</Label>
              <Select
                value={form.priority}
                onValueChange={(value) =>
                  setForm((current) => ({
                    ...current,
                    priority: (value ?? current.priority) as MedicationIssue['priority'],
                  }))
                }
              >
                <SelectTrigger id="issue-priority" className="w-full">
                  {/* Radix は既定値ラベルを SSR 解決できないため表示文言を明示 */}
                  <SelectValue>{issuePriorityLabel[form.priority] ?? form.priority}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(issuePriorityLabel).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="issue-category">カテゴリ</Label>
              <Select
                value={form.category}
                onValueChange={(value) =>
                  setForm((current) => ({
                    ...current,
                    category: (value ?? current.category) as NonNullable<
                      MedicationIssue['category']
                    >,
                  }))
                }
              >
                <SelectTrigger id="issue-category" className="w-full">
                  <SelectValue>{issueCategoryLabel[form.category] ?? form.category}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(issueCategoryLabel).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="issue-status">状態</Label>
              <Select
                value={form.status}
                onValueChange={(value) =>
                  setForm((current) => ({
                    ...current,
                    status: (value ?? current.status) as MedicationIssue['status'],
                  }))
                }
              >
                <SelectTrigger id="issue-status" className="w-full">
                  <SelectValue>{issueStatusLabel[form.status] ?? form.status}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(issueStatusLabel).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            キャンセル
          </Button>
          <Button
            type="button"
            onClick={() => onSubmit(form)}
            disabled={isPending || !form.title.trim() || !form.description.trim()}
          >
            {isPending ? '保存中...' : issue ? '更新' : '登録'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function QrExportDialog({
  open,
  onOpenChange,
  patientName,
  state,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patientName: string;
  state: QrExportState | null;
}) {
  const handlePrint = () => {
    if (!state) return;
    const popup = window.open('', '_blank', 'noopener,noreferrer,width=480,height=720');
    if (!popup) {
      toast.error('印刷ウィンドウを開けませんでした');
      return;
    }

    popup.document.write(`
      <html lang="ja">
        <head>
          <title>${patientName} お薬手帳QR</title>
        </head>
        <body>
          <h1>${patientName} お薬手帳QR</h1>
          <p>生成日時: ${state.generatedAt}</p>
          <img src="${state.dataUrl}" alt="${patientName} お薬手帳QR" width="320" height="320" />
          <pre>${state.payload}</pre>
        </body>
      </html>
    `);
    popup.document.close();
    popup.focus();
    popup.print();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>お薬手帳QRコード</DialogTitle>
          <DialogDescription>
            現在の服薬中薬剤から JAHIS Ver.2.5 形式の QR を生成しています。
          </DialogDescription>
        </DialogHeader>

        {state ? (
          <div className="grid gap-6 md:grid-cols-[340px_minmax(0,1fr)]">
            <div className="rounded-lg border border-border/70 bg-white p-4 text-center shadow-sm">
              <Image
                src={state.dataUrl}
                alt={`${patientName} お薬手帳QR`}
                width={320}
                height={320}
                unoptimized
                className="mx-auto rounded-xl"
              />
              <p className="mt-3 text-xs text-muted-foreground">生成日時: {state.generatedAt}</p>
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                <Button type="button" variant="outline" size="sm" onClick={handlePrint}>
                  <Printer className="size-3.5" aria-hidden="true" />
                  印刷
                </Button>
                <a
                  href={state.dataUrl}
                  download={`${patientName}-medication-qr.png`}
                  className={buttonVariants({ variant: 'outline', size: 'sm' })}
                >
                  <QrCode className="size-3.5" aria-hidden="true" />
                  PNG保存
                </a>
              </div>
            </div>

            <div className="space-y-3">
              <div className="rounded-lg border border-border/70 bg-muted/20 p-4">
                <p className="text-sm font-medium text-foreground">JAHIS ペイロード</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  画面表示と印刷で同じ内容を確認できます。
                </p>
              </div>
              <pre className="max-h-[420px] overflow-auto rounded-lg border border-border/70 bg-slate-950 p-4 text-xs leading-5 text-slate-100">
                {state.payload}
              </pre>
            </div>
          </div>
        ) : (
          <div className="flex min-h-52 items-center justify-center text-sm text-muted-foreground">
            QRコードを生成しています...
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function MedicationsContent({
  patientId,
  patientName,
  patientNameKana,
  birthDate,
  gender,
  allergyInfo,
}: MedicationsContentProps) {
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  const hasPatientContext =
    patientName !== undefined &&
    patientNameKana !== undefined &&
    birthDate !== undefined &&
    gender !== undefined &&
    allergyInfo !== undefined;
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [issueDialogOpen, setIssueDialogOpen] = useState(false);
  const [editingIssue, setEditingIssue] = useState<MedicationIssue | null>(null);
  const [qrDialogOpen, setQrDialogOpen] = useState(false);
  const [qrState, setQrState] = useState<QrExportState | null>(null);

  const {
    data,
    isLoading,
    isError: isProfilesError,
    refetch: refetchProfiles,
  } = useQuery({
    queryKey: ['medication-profiles', orgId, patientId],
    queryFn: async () => {
      const response = await fetch(
        `/api/medication-profiles?${new URLSearchParams({ patient_id: patientId, is_current: 'true' })}`,
        { headers: buildOrgHeaders(orgId) },
      );
      return readApiJson<{ data: MedicationProfile[] }>(response, '取得に失敗しました');
    },
    enabled: !!orgId,
  });

  const patientSummaryQuery = useQuery({
    queryKey: ['patient-medication-summary', patientId, orgId],
    queryFn: async () => {
      const response = await fetch(buildPatientApiPath(patientId), {
        headers: buildOrgHeaders(orgId),
      });
      const payload = await readApiJson<{
        data: {
          name: string;
          name_kana: string;
          birth_date: string;
          gender: string;
          allergy_info: string[] | null;
        };
      }>(response, '患者情報の取得に失敗しました');
      return payload.data;
    },
    enabled: !!orgId && !hasPatientContext,
  });

  const issuesQuery = useQuery({
    queryKey: ['medication-issues', orgId, patientId],
    queryFn: async () => {
      const response = await fetch(
        `/api/medication-issues?${new URLSearchParams({ patient_id: patientId })}`,
        { headers: buildOrgHeaders(orgId) },
      );
      return readApiJson<{ data: MedicationIssue[] }>(response, '課題の取得に失敗しました');
    },
    enabled: !!orgId,
  });

  const inquiryQuery = useQuery({
    queryKey: ['inquiry-records', orgId, patientId],
    queryFn: async () => {
      const response = await fetch(
        `/api/inquiry-records?${new URLSearchParams({ patient_id: patientId })}`,
        { headers: buildOrgHeaders(orgId) },
      );
      return readApiJson<{ data: InquiryRecord[] }>(response, '疑義照会の取得に失敗しました');
    },
    enabled: !!orgId,
  });

  const residualQuery = useQuery({
    queryKey: ['residual-medications', orgId, patientId],
    queryFn: async () => {
      const response = await fetch(
        `/api/residual-medications?${new URLSearchParams({ patient_id: patientId, limit: '100' })}`,
        { headers: buildOrgHeaders(orgId) },
      );
      return readApiJson<{ data: ResidualMedication[] }>(
        response,
        '残薬データの取得に失敗しました',
      );
    },
    enabled: !!orgId,
  });

  const saveIssueMutation = useMutation({
    mutationFn: async (form: IssueFormData) => {
      const isUpdate = Boolean(editingIssue);
      const response = await fetch(
        editingIssue
          ? `/api/medication-issues/${encodePathSegment(editingIssue.id)}`
          : '/api/medication-issues',
        {
          method: isUpdate ? 'PATCH' : 'POST',
          headers: buildOrgJsonHeaders(orgId),
          body: JSON.stringify(
            isUpdate
              ? form
              : {
                  patient_id: patientId,
                  ...form,
                },
          ),
        },
      );
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.message ?? '課題の保存に失敗しました');
      }
      return payload;
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['medication-issues', orgId, patientId] }),
        invalidateQueryKeys(queryClient, getPatientCareQueryKeys({ orgId, patientId })),
      ]);
      toast.success(editingIssue ? '課題を更新しました' : '課題を登録しました');
      setIssueDialogOpen(false);
      setEditingIssue(null);
    },
    onError: (error) => {
      toast.error(messageFromError(error, '課題の保存に失敗しました'));
    },
  });

  const issueStatusMutation = useMutation({
    mutationFn: async ({
      issueId,
      status,
    }: {
      issueId: string;
      status: MedicationIssue['status'];
    }) => {
      const response = await fetch(`/api/medication-issues/${encodePathSegment(issueId)}`, {
        method: 'PATCH',
        headers: buildOrgJsonHeaders(orgId),
        body: JSON.stringify({ status }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.message ?? '課題状態の更新に失敗しました');
      }
      return payload;
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['medication-issues', orgId, patientId] }),
        invalidateQueryKeys(queryClient, getPatientCareQueryKeys({ orgId, patientId })),
      ]);
    },
    onError: (error) => {
      toast.error(messageFromError(error, '課題状態の更新に失敗しました'));
    },
  });

  const profiles = data?.data ?? [];
  const issues = useMemo(() => issuesQuery.data?.data ?? [], [issuesQuery.data?.data]);
  const residuals = useMemo(() => residualQuery.data?.data ?? [], [residualQuery.data?.data]);
  const inquiries = useMemo(() => inquiryQuery.data?.data ?? [], [inquiryQuery.data?.data]);
  const medicationStats = buildMedicationStats(profiles);
  const resolvedPatientName = patientName ?? patientSummaryQuery.data?.name ?? '患者';
  const resolvedPatientNameKana = patientNameKana ?? patientSummaryQuery.data?.name_kana ?? '';
  const resolvedBirthDate = birthDate ?? patientSummaryQuery.data?.birth_date ?? '';
  const resolvedGender = gender ?? patientSummaryQuery.data?.gender ?? 'unknown';
  const resolvedAllergyInfo = allergyInfo ?? patientSummaryQuery.data?.allergy_info ?? null;
  const isAllergyInfoError = allergyInfo === undefined && patientSummaryQuery.isError;

  const openIssues = useMemo(
    () => issues.filter((issue) => issue.status === 'open' || issue.status === 'in_progress'),
    [issues],
  );
  const sideEffectHistory = useMemo(
    () => issues.filter((issue) => issue.category === 'side_effect').slice(0, 4),
    [issues],
  );
  const residualSuggestions = useMemo(
    () =>
      residuals
        .filter((item) => item.is_reduction_target || item.is_prohibited_reduction)
        .sort((left, right) => (right.excess_days ?? 0) - (left.excess_days ?? 0))
        .slice(0, 5),
    [residuals],
  );
  const inquiryBacklog = useMemo(
    () => inquiries.filter((item) => !item.result || item.result === 'pending'),
    [inquiries],
  );

  const handleEditIssue = (issue: MedicationIssue) => {
    setEditingIssue(issue);
    setIssueDialogOpen(true);
  };

  const handleCreateIssue = () => {
    setEditingIssue(null);
    setIssueDialogOpen(true);
  };

  const handleGenerateQrExport = async () => {
    if (profiles.length === 0) {
      toast.error('服薬中薬剤がないため QR を生成できません');
      return;
    }

    setQrDialogOpen(true);
    setQrState(null);

    try {
      const QRCode = await import('qrcode');
      const toSJISModule = await import('qrcode/helper/to-sjis');
      const toSJIS = (toSJISModule.default ?? toSJISModule) as (character: string) => number;
      const payload = buildJahisQRText({
        patient: {
          name: resolvedPatientName,
          nameKana: resolvedPatientNameKana,
          birthDate: resolvedBirthDate,
          gender: normalizePatientGender(resolvedGender),
        },
        medications: profiles.map((item) => ({
          drugCode: null,
          drugName: item.drug_name,
          dose: item.dose,
          frequency: item.frequency,
        })),
        prescriptionDate: format(new Date(), 'yyyy-MM-dd'),
        dispensingDate: format(new Date(), 'yyyy-MM-dd'),
      });
      const dataUrl = await QRCode.toDataURL(payload, {
        errorCorrectionLevel: 'M',
        margin: 2,
        width: 320,
        toSJISFunc: toSJIS,
      });

      setQrState({
        dataUrl,
        payload,
        generatedAt: format(new Date(), 'yyyy/MM/dd HH:mm', { locale: ja }),
      });
    } catch (error) {
      setQrDialogOpen(false);
      toast.error(messageFromError(error, 'QRコードの生成に失敗しました'));
    }
  };

  return (
    <div className="space-y-6">
      <section>
        <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-lg font-semibold">服薬中薬剤</h2>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/qr-scan"
              className={buttonVariants({
                variant: 'outline',
                size: 'sm',
                className: clinicalActionSizeClass,
              })}
            >
              <QrCode className="size-4" aria-hidden="true" />
              QRスキャン
            </Link>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className={clinicalActionSizeClass}
              onClick={handleGenerateQrExport}
            >
              <Printer className="size-4" aria-hidden="true" />
              QR発行
            </Button>
            <Button
              type="button"
              size="sm"
              className={clinicalActionSizeClass}
              onClick={() => setShowAddDialog(true)}
            >
              <Plus className="size-4" aria-hidden="true" />
              薬剤追加
            </Button>
          </div>
        </div>

        {isLoading ? (
          <div role="status" aria-label="服薬中薬剤を読み込み中" aria-live="polite">
            <SkeletonRows rows={4} cols={4} status={false} />
          </div>
        ) : isProfilesError ? (
          <ErrorState
            variant="server"
            size="inline"
            description="服薬中薬剤を読み込めませんでした。現在の処方が表示されていない可能性があります。再読み込みしてください。"
            onRetry={() => void refetchProfiles()}
            retryLabel="再読み込み"
          />
        ) : profiles.length === 0 ? (
          <EmptyState
            icon={Pill}
            title="服薬中の薬剤がありません"
            description="「薬剤追加」またはQRスキャンで登録してください"
          />
        ) : (
          <div className="space-y-6">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {medicationStats.map((item) => (
                <Card key={item.label} className="border-border shadow-sm">
                  <CardHeader className="pb-2">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-muted-foreground">{item.label}</p>
                      <HelpPopover title={item.label} description={item.description} />
                    </div>
                    <p className="font-heading text-2xl leading-snug font-medium">{item.value}</p>
                  </CardHeader>
                </Card>
              ))}
            </div>

            <Card className="border-border shadow-sm">
              <CardHeader>
                <h3 className="font-heading text-base leading-snug font-medium">
                  見やすい薬剤一覧
                </h3>
                <CardDescription>
                  薬剤名、用量、用法、処方医、開始日をカードでまとめています。
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3 xl:grid-cols-2">
                {profiles.map((item) => {
                  const timingTags = extractTimingTags(item.frequency);
                  return (
                    <article
                      key={item.id}
                      className="rounded-xl border border-border bg-card p-4 shadow-sm"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="space-y-1">
                          <p className="text-base font-semibold text-foreground">
                            {item.drug_name}
                          </p>
                          <p className="text-sm text-muted-foreground">
                            {item.dose ?? '用量未登録'} / {item.frequency ?? '用法未登録'}
                          </p>
                        </div>
                        <Badge variant={item.is_current ? 'default' : 'secondary'}>
                          {item.is_current ? '服薬中' : '終了'}
                        </Badge>
                      </div>

                      <div className="mt-3 flex flex-wrap gap-2">
                        {timingTags.map((tag) => (
                          <Badge key={`${item.id}-${tag}`} variant="outline">
                            {tag}
                          </Badge>
                        ))}
                        <Badge variant="secondary">
                          {item.source
                            ? (sourceLabel[item.source] ?? item.source)
                            : '登録方法未設定'}
                        </Badge>
                      </div>

                      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                        <div>
                          <dt className="text-xs text-muted-foreground">処方医</dt>
                          <dd className="mt-1 font-medium text-foreground">
                            {item.prescriber ?? '未登録'}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-xs text-muted-foreground">開始日</dt>
                          <dd className="mt-1 text-foreground">
                            {formatMedicationDate(item.start_date)}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-xs text-muted-foreground">終了日</dt>
                          <dd className="mt-1 text-foreground">
                            {formatMedicationDate(item.end_date)}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-xs text-muted-foreground">確認メモ</dt>
                          <dd className="mt-1 text-foreground">
                            {item.frequency?.includes('頓服')
                              ? '頓服の使用タイミング確認'
                              : item.end_date
                                ? '終了予定と残薬を確認'
                                : '通常の服薬状況を確認'}
                          </dd>
                        </div>
                      </dl>
                    </article>
                  );
                })}
              </CardContent>
            </Card>

            <DataTable columns={columns} data={profiles} caption="服薬中薬剤一覧" />
          </div>
        )}
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <Card className="border-border shadow-sm">
          <CardHeader className="flex flex-row items-start justify-between gap-4">
            <div>
              <h2 className="font-heading text-base leading-snug font-medium">薬学的課題と照会</h2>
              <CardDescription>
                未解決課題の可視化、課題登録、疑義照会の参照を 1 画面にまとめています。
              </CardDescription>
            </div>
            <Button
              type="button"
              size="sm"
              className={clinicalActionSizeClass}
              onClick={handleCreateIssue}
            >
              <ClipboardPlus className="size-4" aria-hidden="true" />
              課題登録
            </Button>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <Badge
                variant={
                  issuesQuery.isError ? 'outline' : openIssues.length > 0 ? 'default' : 'secondary'
                }
              >
                未解決課題 {issuesQuery.isError ? '—' : openIssues.length}
              </Badge>
              <Badge
                variant={
                  inquiryQuery.isError
                    ? 'outline'
                    : inquiryBacklog.length > 0
                      ? 'default'
                      : 'secondary'
                }
              >
                回答待ち照会 {inquiryQuery.isError ? '—' : inquiryBacklog.length}
              </Badge>
              <Badge variant="outline">
                副作用歴 {issuesQuery.isError ? '—' : sideEffectHistory.length}
              </Badge>
            </div>

            <div className="space-y-3">
              {issuesQuery.isLoading ? (
                <div role="status" aria-label="薬学的課題を読み込み中" aria-live="polite">
                  <SkeletonRows rows={3} cols={2} status={false} />
                </div>
              ) : issuesQuery.isError ? (
                <ErrorState
                  variant="server"
                  size="inline"
                  description="薬学的課題を読み込めませんでした。未解決の課題が隠れている可能性があります。再読み込みしてください。"
                  onRetry={() => void issuesQuery.refetch()}
                  retryLabel="再読み込み"
                />
              ) : issues.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
                  課題はまだ登録されていません。服薬アドヒアランス、副作用、重複投与などを登録できます。
                </div>
              ) : (
                issues.map((issue, index) => (
                  <div
                    key={issue.id}
                    className="rounded-xl border border-border/70 bg-background p-4"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-medium text-foreground">{issue.title}</p>
                          <Badge variant={getIssueBadgeVariant(issue)}>
                            {issueStatusLabel[issue.status]}
                          </Badge>
                          <Badge variant="outline">{issuePriorityLabel[issue.priority]}</Badge>
                          {issue.category ? (
                            <Badge variant="outline">{issueCategoryLabel[issue.category]}</Badge>
                          ) : null}
                        </div>
                        <p className="text-sm text-muted-foreground">{issue.description}</p>
                        <p className="text-xs text-muted-foreground">
                          登録日時 {formatDateTimeLabel(issue.identified_at)}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className={clinicalActionSizeClass}
                          aria-label={`薬学的課題${index + 1}件目を編集`}
                          onClick={() => handleEditIssue(issue)}
                        >
                          <Edit3 className="size-3.5" aria-hidden="true" />
                          編集
                        </Button>
                        {issue.status === 'open' ? (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className={clinicalActionSizeClass}
                            onClick={() =>
                              issueStatusMutation.mutate({
                                issueId: issue.id,
                                status: 'in_progress',
                              })
                            }
                            disabled={issueStatusMutation.isPending}
                          >
                            <RefreshCw className="size-3.5" aria-hidden="true" />
                            対応開始
                          </Button>
                        ) : null}
                        {issue.status !== 'resolved' ? (
                          <Button
                            type="button"
                            size="sm"
                            className={clinicalActionSizeClass}
                            onClick={() =>
                              issueStatusMutation.mutate({ issueId: issue.id, status: 'resolved' })
                            }
                            disabled={issueStatusMutation.isPending}
                          >
                            <CheckCircle2 className="size-3.5" aria-hidden="true" />
                            解決
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="rounded-xl border border-border/70 bg-muted/20 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-foreground">疑義照会管理</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    回答待ち・変更あり・変更なしの履歴を患者単位で参照します。
                  </p>
                </div>
                <Link
                  href="/workflow"
                  className={buttonVariants({
                    variant: 'outline',
                    size: 'sm',
                    className: clinicalActionSizeClass,
                  })}
                >
                  ワークベンチへ
                </Link>
              </div>
              <div className="mt-3 space-y-2">
                {inquiryQuery.isLoading ? (
                  <div role="status" aria-label="疑義照会を読み込み中" aria-live="polite">
                    <SkeletonRows rows={2} cols={2} status={false} />
                  </div>
                ) : inquiryQuery.isError ? (
                  <ErrorState
                    variant="server"
                    size="inline"
                    description="疑義照会の記録を読み込めませんでした。回答待ちの照会が隠れている可能性があります。再読み込みしてください。"
                    onRetry={() => void inquiryQuery.refetch()}
                    retryLabel="再読み込み"
                  />
                ) : inquiries.length === 0 ? (
                  <p className="text-sm text-muted-foreground">疑義照会の記録はありません。</p>
                ) : (
                  inquiries.slice(0, 4).map((item) => (
                    <div
                      key={item.id}
                      className="rounded-lg border border-border/70 bg-background p-3"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge
                          variant={
                            item.result === 'pending' || !item.result ? 'outline' : 'secondary'
                          }
                        >
                          {item.result === 'changed'
                            ? '変更あり'
                            : item.result === 'unchanged'
                              ? '変更なし'
                              : '回答待ち'}
                        </Badge>
                        {item.line?.drug_name ? (
                          <span className="text-xs text-muted-foreground">
                            {item.line.line_number ? `#${item.line.line_number} ` : ''}
                            {item.line.drug_name}
                          </span>
                        ) : null}
                        {item.proposal_origin === 'pre_issuance' ? (
                          <Badge variant="outline">事前提案反映</Badge>
                        ) : null}
                        {item.residual_adjustment ? (
                          <Badge variant="outline">残薬調整</Badge>
                        ) : null}
                      </div>
                      <p className="mt-2 text-sm font-medium text-foreground">{item.reason}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {item.inquiry_to_physician} / 照会日時{' '}
                        {formatDateTimeLabel(item.inquired_at)}
                      </p>
                      {item.change_detail ? (
                        <p className="mt-2 text-xs text-muted-foreground">{item.change_detail}</p>
                      ) : null}
                    </div>
                  ))
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card className="border-border shadow-sm">
            <CardHeader>
              <h2 className="font-heading text-base leading-snug font-medium">
                アレルギー・副作用歴
              </h2>
              <CardDescription>
                基本情報の登録内容と、副作用カテゴリの課題履歴をここでまとめて確認します。
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <p className="text-xs font-medium text-muted-foreground">登録済みアレルギー</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {isAllergyInfoError ? (
                    <ErrorState
                      variant="server"
                      size="inline"
                      description="アレルギー情報を読み込めませんでした。登録済みのアレルギーが表示されていない可能性があります。再読み込みしてください。"
                      onRetry={() => void patientSummaryQuery.refetch()}
                      retryLabel="再読み込み"
                    />
                  ) : resolvedAllergyInfo && resolvedAllergyInfo.length > 0 ? (
                    resolvedAllergyInfo.map((item, index) => {
                      const label = typeof item === 'string' ? item : item.drug_name;
                      return (
                        <Badge key={`${label}-${index}`} variant="outline">
                          {label}
                        </Badge>
                      );
                    })
                  ) : (
                    <span className="text-sm text-muted-foreground">登録なし</span>
                  )}
                </div>
              </div>

              <div>
                <p className="text-xs font-medium text-muted-foreground">副作用履歴</p>
                <div className="mt-2 space-y-2">
                  {issuesQuery.isError ? (
                    <ErrorState
                      variant="server"
                      size="inline"
                      description="副作用歴を読み込めませんでした。登録済みの副作用が表示されていない可能性があります。再読み込みしてください。"
                      onRetry={() => void issuesQuery.refetch()}
                      retryLabel="再読み込み"
                    />
                  ) : sideEffectHistory.length > 0 ? (
                    sideEffectHistory.map((item) => (
                      <div key={item.id} className="rounded-lg border border-border/70 p-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant={getIssueBadgeVariant(item)}>
                            {issueStatusLabel[item.status]}
                          </Badge>
                          <p className="text-sm font-medium text-foreground">{item.title}</p>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">{item.description}</p>
                      </div>
                    ))
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      副作用歴はまだ登録されていません。
                    </p>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-border shadow-sm">
            <CardHeader>
              <h2 className="font-heading text-base leading-snug font-medium">
                残薬管理と次回提案
              </h2>
              <CardDescription>
                残薬の推移、減数候補、減数禁止薬の注意を次回処方へつなげます。
              </CardDescription>
              <CardAction>
                <Link
                  href={buildPatientHref(patientId, '/residual-adjustment')}
                  className={buttonVariants({
                    variant: 'outline',
                    size: 'sm',
                    className: clinicalActionSizeClass,
                  })}
                >
                  残薬調整を開く
                </Link>
              </CardAction>
            </CardHeader>
            <CardContent className="space-y-4">
              <ResidualMedicationChart patientId={patientId} />
              <div className="space-y-2">
                {residualQuery.isLoading ? (
                  <div role="status" aria-label="残薬提案を読み込み中" aria-live="polite">
                    <SkeletonRows rows={2} cols={3} status={false} />
                  </div>
                ) : residualQuery.isError ? (
                  <ErrorState
                    variant="server"
                    size="inline"
                    description="残薬提案を読み込めませんでした。減数禁止薬や余剰の注意が隠れている可能性があります。再読み込みしてください。"
                    onRetry={() => void residualQuery.refetch()}
                    retryLabel="再読み込み"
                  />
                ) : residualSuggestions.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
                    7日超の余剰や減数禁止薬の注意はまだありません。
                  </div>
                ) : (
                  residualSuggestions.map((item) => (
                    <div
                      key={item.id}
                      className="rounded-xl border border-border/70 bg-background p-4"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium text-foreground">{item.drug_name}</p>
                        {item.is_prohibited_reduction ? (
                          <Badge variant="destructive">減数禁止</Badge>
                        ) : (
                          <Badge variant="outline">減数候補</Badge>
                        )}
                      </div>
                      <p className="mt-2 text-sm text-muted-foreground">
                        残数 {item.remaining_quantity}
                        {item.excess_days !== null ? ` / 余剰 ${item.excess_days}日` : ''}
                        {item.prescribed_quantity !== null
                          ? ` / 前回処方量 ${item.prescribed_quantity}`
                          : ''}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {item.is_prohibited_reduction
                          ? '麻薬・抗がん剤など減数禁止の確認が必要です。医師報告と現物確認を優先してください。'
                          : '次回処方受付時に減数調整候補として確認し、必要なら疑義照会へ引き継いでください。'}
                      </p>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>

          <Card className="border-border shadow-sm">
            <CardHeader>
              <h2 className="font-heading text-base leading-snug font-medium">お薬手帳QR発行</h2>
              <CardDescription>
                服薬中薬剤から JAHIS Ver.2.5 の QR を生成し、その場で表示と印刷ができます。
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="rounded-xl border border-border/70 bg-muted/20 p-4 text-sm text-muted-foreground">
                患者名、生年月日、服薬中薬剤を QR に反映します。QR
                スキャンと対になる発行方向の導線です。
              </div>
              <Button type="button" onClick={handleGenerateQrExport}>
                <QrCode className="size-4" aria-hidden="true" />
                お薬手帳QRを生成
              </Button>
            </CardContent>
          </Card>
        </div>
      </section>

      {showAddDialog ? (
        <AddMedicationDialog patientId={patientId} onClose={() => setShowAddDialog(false)} />
      ) : null}

      {issueDialogOpen ? (
        <IssueEditorDialog
          key={editingIssue?.id ?? 'new'}
          issue={editingIssue}
          open={issueDialogOpen}
          onOpenChange={(open) => {
            setIssueDialogOpen(open);
            if (!open) setEditingIssue(null);
          }}
          onSubmit={(form) => saveIssueMutation.mutate(form)}
          isPending={saveIssueMutation.isPending}
        />
      ) : null}

      <QrExportDialog
        open={qrDialogOpen}
        onOpenChange={setQrDialogOpen}
        patientName={resolvedPatientName}
        state={qrState}
      />
    </div>
  );
}
