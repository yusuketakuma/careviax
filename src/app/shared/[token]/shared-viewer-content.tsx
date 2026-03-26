'use client';

import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { ja } from 'date-fns/locale';
import {
  CalendarClock,
  FileText,
  HeartHandshake,
  Lock,
  Pill,
  ShieldCheck,
} from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

type ExternalPayload = {
  patient: {
    id: string;
    name: string;
    birth_date: string | null;
    gender: string | null;
    phone?: string | null;
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
  scope: Record<string, boolean>;
  expires_at: string;
};

const SELF_REPORT_CATEGORIES = [
  '服薬の困りごと',
  '残薬',
  '副作用・体調変化',
  '訪問日時の相談',
  '医療材料・注射関連',
  'その他',
];

export function SharedViewerContent({
  token,
  initialOtp,
}: {
  token: string;
  initialOtp: string;
}) {
  const [otpInput, setOtpInput] = useState(initialOtp);
  const [activeOtp, setActiveOtp] = useState(initialOtp);
  const [reporterName, setReporterName] = useState('');
  const [relation, setRelation] = useState('');
  const [category, setCategory] = useState(SELF_REPORT_CATEGORIES[0] ?? 'その他');
  const [subject, setSubject] = useState('');
  const [content, setContent] = useState('');
  const [preferredContactTime, setPreferredContactTime] = useState('');
  const [requestedCallback, setRequestedCallback] = useState(true);

  const viewerQuery = useQuery({
    queryKey: ['shared-viewer', token, activeOtp],
    enabled: activeOtp.trim().length > 0,
    queryFn: async () => {
      const response = await fetch(
        `/api/external-access/${token}?otp=${encodeURIComponent(activeOtp)}`
      );

      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.message ?? '共有情報の取得に失敗しました');
      }

      return payload as { data: ExternalPayload };
    },
  });

  const selfReportMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(`/api/external-access/${token}/self-report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          otp: activeOtp,
          reported_by_name: reporterName,
          relation: relation || undefined,
          category,
          subject,
          content,
          requested_callback: requestedCallback,
          preferred_contact_time: preferredContactTime || undefined,
        }),
      });

      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.message ?? '自己申告の送信に失敗しました');
      }

      return payload as { data: { id: string } };
    },
    onSuccess: () => {
      setSubject('');
      setContent('');
      setPreferredContactTime('');
      setRequestedCallback(true);
      toast.success('自己申告を受け付けました');
    },
    onError: (error: Error) => {
      toast.error(error.message);
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

  function submitSelfReport() {
    if (!reporterName.trim() || !subject.trim() || !content.trim()) {
      toast.error('報告者氏名・件名・内容は必須です');
      return;
    }

    selfReportMutation.mutate();
  }

  return (
    <div className="space-y-6">
      <Card className="border-slate-200 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <ShieldCheck className="size-5 text-emerald-600" aria-hidden="true" />
            外部共有ポータル
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
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
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
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
                  <p className="font-medium">{data.patient.name}</p>
                </div>
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
                    <p>{data.patient.gender ?? '未登録'}</p>
                  </div>
                </div>
                {data.patient.phone ? (
                  <div>
                    <p className="text-xs text-muted-foreground">連絡先</p>
                    <p>{data.patient.phone}</p>
                  </div>
                ) : null}
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
                        {key}
                      </Badge>
                    ))}
                </div>
                <div className="text-muted-foreground">
                  有効期限: {format(new Date(data.expires_at), 'yyyy年M月d日 HH:mm', { locale: ja })}
                </div>
              </CardContent>
            </Card>
          </div>

          {data.medication_profiles && data.medication_profiles.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Pill className="size-4 text-sky-700" aria-hidden="true" />
                  服薬情報
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {data.medication_profiles.map((item) => (
                  <div key={item.id} className="rounded-lg border border-slate-200 p-3 text-sm">
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
                    <CalendarClock className="size-4 text-indigo-700" aria-hidden="true" />
                    直近の訪問予定
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {data.visit_schedules.length === 0 ? (
                    <p className="text-sm text-muted-foreground">予定は登録されていません。</p>
                  ) : (
                    data.visit_schedules.map((item) => (
                      <div key={item.id} className="rounded-lg border border-slate-200 p-3 text-sm">
                        <p className="font-medium">
                          {format(new Date(item.scheduled_date), 'yyyy年M月d日(E)', { locale: ja })}
                        </p>
                        <p className="text-muted-foreground">
                          状態: {item.schedule_status}
                        </p>
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
                    <FileText className="size-4 text-emerald-700" aria-hidden="true" />
                    共有済み報告書
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {data.care_reports.length === 0 ? (
                    <p className="text-sm text-muted-foreground">共有できる報告書はありません。</p>
                  ) : (
                    data.care_reports.map((item) => (
                      <div key={item.id} className="rounded-lg border border-slate-200 p-3 text-sm">
                        <p className="font-medium">{item.report_type}</p>
                        <p className="text-muted-foreground">
                          {format(new Date(item.created_at), 'yyyy年M月d日', { locale: ja })} / {item.status}
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
                <HeartHandshake className="size-4 text-rose-700" aria-hidden="true" />
                患者・ご家族からの連絡
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="reporter-name">報告者氏名</Label>
                  <Input
                    id="reporter-name"
                    value={reporterName}
                    onChange={(event) => setReporterName(event.target.value)}
                    placeholder="例: 山田花子"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="reporter-relation">患者との関係</Label>
                  <Input
                    id="reporter-relation"
                    value={relation}
                    onChange={(event) => setRelation(event.target.value)}
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
                  onChange={(event) => setCategory(event.target.value)}
                />
                <datalist id="self-report-categories">
                  {SELF_REPORT_CATEGORIES.map((item) => (
                    <option key={item} value={item} />
                  ))}
                </datalist>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="report-subject">件名</Label>
                <Input
                  id="report-subject"
                  value={subject}
                  onChange={(event) => setSubject(event.target.value)}
                  placeholder="例: 残薬が増えてきた"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="report-content">内容</Label>
                <Textarea
                  id="report-content"
                  value={content}
                  onChange={(event) => setContent(event.target.value)}
                  placeholder="服薬の困りごと、残薬、体調変化、連絡事項を入力してください"
                  rows={5}
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="preferred-contact-time">折返し希望時間</Label>
                  <Input
                    id="preferred-contact-time"
                    value={preferredContactTime}
                    onChange={(event) => setPreferredContactTime(event.target.value)}
                    placeholder="例: 平日18時以降"
                  />
                </div>
                <label className="flex items-center gap-2 pt-7 text-sm">
                  <input
                    type="checkbox"
                    checked={requestedCallback}
                    onChange={(event) => setRequestedCallback(event.target.checked)}
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
