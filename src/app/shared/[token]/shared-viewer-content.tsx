'use client';

import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { format, parseISO } from 'date-fns';
import { ja } from 'date-fns/locale';
import {
  CalendarClock,
  FileText,
  HeartHandshake,
  Lock,
  Pill,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { StateBadge } from '@/components/ui/state-badge';
import { Textarea } from '@/components/ui/textarea';
import type { PatientArchiveSummary } from '@/lib/patient/archive-summary';
import { createClientIdempotencyKey } from '@/lib/idempotency/client-key';
import { messageFromError } from '@/lib/utils/error-message';

type ExternalPayload = {
  patient: {
    id: string;
    name: string;
    birth_date: string | null;
    gender: string | null;
    archive?: PatientArchiveSummary | null;
  };
  allergy_info?: string | null;
  medication_profiles?: Array<{
    id: string;
    drug_name: string;
    dose: string | null;
    frequency: string | null;
    start_date: string | null;
    end_date: string | null;
    is_current: boolean;
  }>;
  visit_schedules?: Array<{
    id: string;
    scheduled_date: string;
    time_window_start: string | null;
    time_window_end: string | null;
    schedule_status: string;
  }>;
  care_reports?: Array<{
    id: string;
    report_type: string;
    status: string;
    created_at: string;
  }>;
  self_report_history?: Array<{
    id: string;
    reported_by_name: string;
    relation: string | null;
    category: string;
    subject: string;
    content: string;
    requested_callback: boolean;
    preferred_contact_time: string | null;
    status: string;
    created_at: string;
    triaged_at: string | null;
  }>;
  shared_summary?: {
    headline: string;
    bullets: string[];
    key_medications: string[];
    next_visit_date: string | null;
  };
  scope: Record<string, boolean>;
  expires_at: string;
};

type SelfReportSubmitPayload = {
  reported_by_name: string;
  relation?: string;
  category: string;
  subject: string;
  content: string;
  requested_callback: boolean;
  preferred_contact_time?: string;
};

type SelfReportSubmitError = Error & {
  status?: number;
};

type SelfReportFieldErrors = Partial<{
  reporterName: string;
  subject: string;
  content: string;
}>;

type SelfReportDraft = {
  reporterName: string;
  relation: string;
  category: string;
  subject: string;
  content: string;
  preferredContactTime: string;
  requestedCallback: boolean;
};

const SCOPE_DISPLAY_NAMES: Record<string, string> = {
  allergy_info: 'アレルギー情報',
  medication_list: '服薬一覧',
  medication_profiles: '服薬一覧',
  visit_schedule: '訪問予定',
  visit_schedules: '訪問予定',
  care_reports: '訪問報告書',
  self_report_history: '自己申告履歴',
  shared_summary: 'AIサマリー',
  lab_summary: '検査値サマリー',
};

const SELF_REPORT_CATEGORIES = [
  '服薬の困りごと',
  '残薬',
  '副作用・体調変化',
  '訪問日時の相談',
  '医療材料・注射関連',
  'その他',
];
const DEFAULT_SELF_REPORT_CATEGORY = SELF_REPORT_CATEGORIES[0] ?? 'その他';
const SELF_REPORT_DRAFT_STORAGE_PREFIX = 'ph-os:self-report-draft:v1:';

const SELF_REPORT_STATUS_LABELS: Record<string, string> = {
  pending: '未対応',
  triaged: 'トリアージ済',
  resolved: '解決済',
  closed: '完了',
};

const RELATION_LABELS: Record<string, string> = {
  self: '本人',
  spouse: '配偶者',
  child: '子',
  parent: '親',
  sibling: '兄弟姉妹',
  care_manager: 'ケアマネ',
  physician: '医師',
  nurse: '看護師',
  facility_staff: '施設職員',
  other: 'その他',
};

const GENDER_LABELS: Record<string, string> = {
  male: '男性',
  female: '女性',
  other: 'その他',
  unknown: '不明',
};

function createSelfReportIdempotencyKey() {
  return createClientIdempotencyKey('self-report');
}

function createEmptySelfReportDraft(): SelfReportDraft {
  return {
    reporterName: '',
    relation: '',
    category: DEFAULT_SELF_REPORT_CATEGORY,
    subject: '',
    content: '',
    preferredContactTime: '',
    requestedCallback: true,
  };
}

function buildSelfReportDraftStorageKey(token: string) {
  return `${SELF_REPORT_DRAFT_STORAGE_PREFIX}${encodeURIComponent(token)}`;
}

function readStringDraftField(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function isSelfReportDraftEmpty(draft: SelfReportDraft) {
  return (
    draft.reporterName.trim().length === 0 &&
    draft.relation.trim().length === 0 &&
    draft.subject.trim().length === 0 &&
    draft.content.trim().length === 0 &&
    draft.preferredContactTime.trim().length === 0 &&
    (draft.category.trim().length === 0 || draft.category === DEFAULT_SELF_REPORT_CATEGORY) &&
    draft.requestedCallback
  );
}

function readSelfReportDraft(token: string): SelfReportDraft | null {
  if (typeof window === 'undefined') return null;

  try {
    const rawDraft = window.sessionStorage.getItem(buildSelfReportDraftStorageKey(token));
    if (!rawDraft) return null;

    const parsed: unknown = JSON.parse(rawDraft);
    if (!parsed || typeof parsed !== 'object') return null;

    const record = parsed as Record<string, unknown>;
    const draft: SelfReportDraft = {
      reporterName: readStringDraftField(record.reporterName),
      relation: readStringDraftField(record.relation),
      category: readStringDraftField(record.category) || DEFAULT_SELF_REPORT_CATEGORY,
      subject: readStringDraftField(record.subject),
      content: readStringDraftField(record.content),
      preferredContactTime: readStringDraftField(record.preferredContactTime),
      requestedCallback:
        typeof record.requestedCallback === 'boolean' ? record.requestedCallback : true,
    };

    return isSelfReportDraftEmpty(draft) ? null : draft;
  } catch {
    return null;
  }
}

function writeSelfReportDraft(token: string, draft: SelfReportDraft) {
  if (typeof window === 'undefined') return;

  try {
    const key = buildSelfReportDraftStorageKey(token);
    if (isSelfReportDraftEmpty(draft)) {
      window.sessionStorage.removeItem(key);
      return;
    }

    window.sessionStorage.setItem(key, JSON.stringify(draft));
  } catch {
    return;
  }
}

function clearSelfReportDraft(token: string) {
  if (typeof window === 'undefined') return;

  try {
    window.sessionStorage.removeItem(buildSelfReportDraftStorageKey(token));
  } catch {
    return;
  }
}

export function SharedViewerContent({ token }: { token: string }) {
  const [otpInput, setOtpInput] = useState('');
  const [activeOtp, setActiveOtp] = useState('');
  const [selfReportDraft, setSelfReportDraft] = useState<SelfReportDraft>(
    () => readSelfReportDraft(token) ?? createEmptySelfReportDraft(),
  );
  const [selfReportErrors, setSelfReportErrors] = useState<SelfReportFieldErrors>({});
  const selfReportSubmissionRef = useRef<{
    payloadFingerprint: string;
    idempotencyKey: string;
  } | null>(null);

  useEffect(() => {
    writeSelfReportDraft(token, selfReportDraft);
  }, [selfReportDraft, token]);

  const {
    reporterName,
    relation,
    category,
    subject,
    content,
    preferredContactTime,
    requestedCallback,
  } = selfReportDraft;

  const viewerQuery = useQuery({
    queryKey: ['shared-viewer', token, activeOtp],
    enabled: activeOtp.trim().length > 0,
    queryFn: async () => {
      const response = await fetch(`/api/external-access/${token}`, {
        headers: { 'x-otp': activeOtp },
      });

      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.message ?? '共有情報の取得に失敗しました');
      }

      return payload as { data: ExternalPayload };
    },
  });

  const selfReportMutation = useMutation({
    mutationFn: async () => {
      const body: SelfReportSubmitPayload = {
        reported_by_name: reporterName,
        relation: relation || undefined,
        category,
        subject,
        content,
        requested_callback: requestedCallback,
        preferred_contact_time: preferredContactTime || undefined,
      };
      const payloadFingerprint = JSON.stringify(body);
      if (selfReportSubmissionRef.current?.payloadFingerprint !== payloadFingerprint) {
        selfReportSubmissionRef.current = {
          payloadFingerprint,
          idempotencyKey: createSelfReportIdempotencyKey(),
        };
      }

      const response = await fetch(`/api/external-access/${token}/self-report`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': selfReportSubmissionRef.current.idempotencyKey,
          'x-otp': activeOtp,
        },
        body: JSON.stringify(body),
      });

      const payload = await response.json();
      if (!response.ok) {
        const submitError = new Error(
          payload.message ?? '自己申告の送信に失敗しました',
        ) as SelfReportSubmitError;
        submitError.status = response.status;
        throw submitError;
      }

      return payload as { data: { accepted: boolean; replayed: boolean } };
    },
    onSuccess: () => {
      selfReportSubmissionRef.current = null;
      clearSelfReportDraft(token);
      setSelfReportDraft(createEmptySelfReportDraft());
      setSelfReportErrors({});
      void viewerQuery.refetch();
      toast.success('自己申告を受け付けました');
    },
    onError: (error: Error) => {
      const submitError = error as SelfReportSubmitError;
      if (submitError.status === 409) {
        toast.error('同じ送信内容は受付済みの可能性があります。画面を更新して確認してください');
        return;
      }
      if (submitError.status === 429) {
        toast.error('送信回数が多すぎます。しばらく待ってから再試行してください');
        return;
      }
      toast.error(messageFromError(error, '自己申告の送信に失敗しました'));
    },
  });

  const data = viewerQuery.data?.data;

  function unlock() {
    if (!otpInput.trim()) {
      toast.error('OTPを入力してください');
      return;
    }

    setActiveOtp(otpInput.trim());
  }

  function clearSelfReportError(field: keyof SelfReportFieldErrors) {
    setSelfReportErrors((current) => {
      if (!current[field]) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
  }

  function updateSelfReportDraft<Key extends keyof SelfReportDraft>(
    field: Key,
    value: SelfReportDraft[Key],
  ) {
    setSelfReportDraft((current) => ({
      ...current,
      [field]: value,
    }));
  }

  function submitSelfReport() {
    if (selfReportMutation.isPending) return;
    const nextErrors: SelfReportFieldErrors = {};
    if (!reporterName.trim()) {
      nextErrors.reporterName = '報告者氏名を入力してください';
    }
    if (!subject.trim()) {
      nextErrors.subject = '件名を入力してください';
    }
    if (!content.trim()) {
      nextErrors.content = '内容を入力してください';
    }
    setSelfReportErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      toast.error('必須項目を確認してください');
      return;
    }

    selfReportMutation.mutate();
  }

  return (
    <div className="space-y-6">
      <Card className="border-border shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <ShieldCheck className="size-5 text-muted-foreground" aria-hidden="true" />
            外部共有ポータル
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg border-l-4 border-border/70 border-l-tag-info bg-card px-4 py-3 text-sm text-tag-info">
            共有情報の閲覧には OTP が必要です。入力内容は患者支援のために薬局内で記録されます。
          </div>

          <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
            <div className="space-y-1.5">
              <Label htmlFor="shared-otp">OTP</Label>
              <Input
                id="shared-otp"
                value={otpInput}
                onChange={(event) => setOtpInput(event.target.value)}
                placeholder="6桁のOTPを入力"
                inputMode="numeric"
              />
            </div>
            <Button className="self-end" onClick={unlock} disabled={viewerQuery.isFetching}>
              <Lock className="mr-1.5 size-4" aria-hidden="true" />
              {viewerQuery.isFetching ? '確認中...' : '閲覧する'}
            </Button>
          </div>

          {viewerQuery.error instanceof Error ? (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {viewerQuery.error.message}
            </div>
          ) : null}
        </CardContent>
      </Card>

      {data ? (
        <>
          <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">患者情報</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div>
                  <p className="text-xs text-muted-foreground">氏名</p>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <p className="font-medium">{data.patient.name}</p>
                    {data.patient.archive?.archived ? (
                      <StateBadge role="readonly" className="text-[11px] font-bold">
                        アーカイブ中
                      </StateBadge>
                    ) : null}
                  </div>
                </div>
                {data.patient.archive?.archived ? (
                  <div
                    role="status"
                    className="rounded-md border border-state-readonly/30 bg-state-readonly/10 px-3 py-2 text-xs font-medium text-foreground"
                  >
                    共有元では閲覧専用の患者情報として扱われています。最新の対応可否は薬局へ確認してください。
                  </div>
                ) : null}
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <p className="text-xs text-muted-foreground">生年月日</p>
                    <p>
                      {data.patient.birth_date
                        ? format(new Date(data.patient.birth_date), 'yyyy年M月d日', { locale: ja })
                        : '未登録'}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">性別</p>
                    <p>
                      {data.patient.gender
                        ? (GENDER_LABELS[data.patient.gender] ?? data.patient.gender)
                        : '未登録'}
                    </p>
                  </div>
                </div>
                {data.allergy_info ? (
                  <div>
                    <p className="text-xs text-muted-foreground">アレルギー情報</p>
                    <p className="whitespace-pre-line">{data.allergy_info}</p>
                  </div>
                ) : null}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">共有条件</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="flex flex-wrap gap-2">
                  {Object.entries(data.scope)
                    .filter(([, enabled]) => enabled)
                    .map(([key]) => (
                      <Badge key={key} variant="outline">
                        {SCOPE_DISPLAY_NAMES[key] ?? key}
                      </Badge>
                    ))}
                </div>
                <div className="text-muted-foreground">
                  有効期限:{' '}
                  {format(new Date(data.expires_at), 'yyyy年M月d日 HH:mm', { locale: ja })}
                </div>
              </CardContent>
            </Card>
          </div>

          {data.shared_summary ? (
            <Card className="border-border bg-muted/40">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Sparkles className="size-4 text-muted-foreground" aria-hidden="true" />
                  共有サマリー
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <p className="font-medium text-foreground">{data.shared_summary.headline}</p>
                {data.shared_summary.bullets.length > 0 ? (
                  <ul className="space-y-1 text-foreground">
                    {data.shared_summary.bullets.map((item) => (
                      <li key={item}>- {item}</li>
                    ))}
                  </ul>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  {data.shared_summary.key_medications.map((item) => (
                    <Badge key={item} variant="secondary">
                      {item}
                    </Badge>
                  ))}
                  {data.shared_summary.next_visit_date ? (
                    <Badge variant="outline">
                      次回訪問{' '}
                      {format(new Date(data.shared_summary.next_visit_date), 'M月d日(E)', {
                        locale: ja,
                      })}
                    </Badge>
                  ) : null}
                </div>
              </CardContent>
            </Card>
          ) : null}

          {(data.self_report_history?.length ?? 0) > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <HeartHandshake className="size-4 text-muted-foreground" aria-hidden="true" />
                  過去の自己申告
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                {data.self_report_history?.map((report) => (
                  <div
                    key={report.id}
                    className="rounded-lg border border-border/70 bg-background px-3 py-3"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="font-medium text-foreground">{report.subject}</p>
                        <p className="text-xs text-muted-foreground">
                          {report.reported_by_name}
                          {report.relation
                            ? ` (${RELATION_LABELS[report.relation] ?? report.relation})`
                            : ''}{' '}
                          / {report.category}
                        </p>
                      </div>
                      <Badge variant="outline">
                        {SELF_REPORT_STATUS_LABELS[report.status] ?? report.status}
                      </Badge>
                    </div>
                    <p className="mt-2 whitespace-pre-line text-xs leading-5 text-muted-foreground">
                      {report.content}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-muted-foreground">
                      <span>
                        受付{' '}
                        {format(parseISO(report.created_at), 'yyyy年M月d日 HH:mm', {
                          locale: ja,
                        })}
                      </span>
                      {report.preferred_contact_time ? (
                        <span>希望連絡帯 {report.preferred_contact_time}</span>
                      ) : null}
                      {report.requested_callback ? <span>折返し希望</span> : null}
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : null}

          {data.medication_profiles && data.medication_profiles.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Pill className="size-4 text-muted-foreground" aria-hidden="true" />
                  服薬情報
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {data.medication_profiles.map((item) => (
                  <div key={item.id} className="rounded-lg border border-border p-3 text-sm">
                    <p className="font-medium">{item.drug_name}</p>
                    <p className="text-muted-foreground">
                      {item.dose ?? '用量未登録'} / {item.frequency ?? '用法未登録'}
                    </p>
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : null}

          <div className="grid gap-4 lg:grid-cols-2">
            {data.visit_schedules ? (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <CalendarClock className="size-4 text-muted-foreground" aria-hidden="true" />
                    直近の訪問予定
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {data.visit_schedules.length === 0 ? (
                    <p className="text-sm text-muted-foreground">予定は登録されていません。</p>
                  ) : (
                    data.visit_schedules.map((item) => (
                      <div key={item.id} className="rounded-lg border border-border p-3 text-sm">
                        <p className="font-medium">
                          {format(new Date(item.scheduled_date), 'yyyy年M月d日(E)', { locale: ja })}
                        </p>
                        <p className="text-muted-foreground">状態: {item.schedule_status}</p>
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>
            ) : null}

            {data.care_reports ? (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <FileText className="size-4 text-muted-foreground" aria-hidden="true" />
                    共有済み報告書
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {data.care_reports.length === 0 ? (
                    <p className="text-sm text-muted-foreground">共有できる報告書はありません。</p>
                  ) : (
                    data.care_reports.map((item) => (
                      <div key={item.id} className="rounded-lg border border-border p-3 text-sm">
                        <p className="font-medium">{item.report_type}</p>
                        <p className="text-muted-foreground">
                          {format(new Date(item.created_at), 'yyyy年M月d日', { locale: ja })} /{' '}
                          {item.status}
                        </p>
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>
            ) : null}
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <HeartHandshake className="size-4 text-muted-foreground" aria-hidden="true" />
                患者・ご家族からの連絡
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {Object.keys(selfReportErrors).length > 0 ? (
                <div
                  role="alert"
                  className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
                >
                  報告者氏名・件名・内容を確認してください。
                </div>
              ) : null}
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="reporter-name">
                    報告者氏名 <span aria-hidden="true">*</span>
                  </Label>
                  <Input
                    id="reporter-name"
                    value={reporterName}
                    onChange={(event) => {
                      updateSelfReportDraft('reporterName', event.target.value);
                      clearSelfReportError('reporterName');
                    }}
                    placeholder="例: 山田花子"
                    required
                    aria-invalid={Boolean(selfReportErrors.reporterName)}
                    aria-describedby={
                      selfReportErrors.reporterName ? 'reporter-name-error' : undefined
                    }
                  />
                  {selfReportErrors.reporterName ? (
                    <p id="reporter-name-error" role="alert" className="text-xs text-destructive">
                      {selfReportErrors.reporterName}
                    </p>
                  ) : null}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="reporter-relation">患者との関係</Label>
                  <Input
                    id="reporter-relation"
                    value={relation}
                    onChange={(event) => updateSelfReportDraft('relation', event.target.value)}
                    placeholder="例: 長女"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="report-category">カテゴリ</Label>
                <Input
                  id="report-category"
                  list="self-report-categories"
                  value={category}
                  onChange={(event) => updateSelfReportDraft('category', event.target.value)}
                />
                <datalist id="self-report-categories">
                  {SELF_REPORT_CATEGORIES.map((item) => (
                    <option key={item} value={item} />
                  ))}
                </datalist>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="report-subject">
                  件名 <span aria-hidden="true">*</span>
                </Label>
                <Input
                  id="report-subject"
                  value={subject}
                  onChange={(event) => {
                    updateSelfReportDraft('subject', event.target.value);
                    clearSelfReportError('subject');
                  }}
                  placeholder="例: 残薬が増えてきた"
                  required
                  aria-invalid={Boolean(selfReportErrors.subject)}
                  aria-describedby={selfReportErrors.subject ? 'report-subject-error' : undefined}
                />
                {selfReportErrors.subject ? (
                  <p id="report-subject-error" role="alert" className="text-xs text-destructive">
                    {selfReportErrors.subject}
                  </p>
                ) : null}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="report-content">
                  内容 <span aria-hidden="true">*</span>
                </Label>
                <Textarea
                  id="report-content"
                  value={content}
                  onChange={(event) => {
                    updateSelfReportDraft('content', event.target.value);
                    clearSelfReportError('content');
                  }}
                  placeholder="服薬の困りごと、残薬、体調変化、連絡事項を入力してください"
                  rows={5}
                  required
                  aria-invalid={Boolean(selfReportErrors.content)}
                  aria-describedby={selfReportErrors.content ? 'report-content-error' : undefined}
                />
                {selfReportErrors.content ? (
                  <p id="report-content-error" role="alert" className="text-xs text-destructive">
                    {selfReportErrors.content}
                  </p>
                ) : null}
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="preferred-contact-time">折返し希望時間</Label>
                  <Input
                    id="preferred-contact-time"
                    value={preferredContactTime}
                    onChange={(event) =>
                      updateSelfReportDraft('preferredContactTime', event.target.value)
                    }
                    placeholder="例: 平日18時以降"
                  />
                </div>
                <label className="flex items-center gap-2 pt-7 text-sm">
                  <input
                    type="checkbox"
                    checked={requestedCallback}
                    onChange={(event) =>
                      updateSelfReportDraft('requestedCallback', event.target.checked)
                    }
                  />
                  薬局からの折返しを希望する
                </label>
              </div>

              <Button onClick={submitSelfReport} disabled={selfReportMutation.isPending}>
                {selfReportMutation.isPending ? '送信中...' : '薬局へ送信'}
              </Button>
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  );
}
