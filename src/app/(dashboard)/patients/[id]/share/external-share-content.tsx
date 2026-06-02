'use client';

import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Copy, Link2, Clock, ShieldAlert, CheckCircle2, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { ActionRail } from '@/components/ui/action-rail';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loading } from '@/components/ui/loading';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useOrgId } from '@/lib/hooks/use-org-id';

// --- Types ---

type ScopeItem = {
  key: string;
  label: string;
  description: string;
};

type GeneratedGrant = {
  shareUrl: string;
  otp: string;
  expiresAt: string;
  otpDelivery: 'sms' | 'manual';
  otpDeliveryDestination: string | null;
};

type ExternalShareOverview = {
  external_shares: Array<{
    id: string;
    granted_to_name: string;
    expires_at: string;
    accessed_at: string | null;
  }>;
  self_reports: Array<{
    id: string;
    subject: string;
    created_at: string;
    status: string;
  }>;
};

// --- Constants ---

const SCOPE_ITEMS: ScopeItem[] = [
  { key: 'medication_list', label: '服薬情報', description: '処方薬・用法・用量の一覧' },
  { key: 'visit_schedule', label: '訪問スケジュール', description: '直近の訪問予定' },
  { key: 'care_reports', label: '服薬指導報告書', description: '直近3件の報告書' },
  { key: 'allergy_info', label: 'アレルギー情報', description: '登録済みアレルギー' },
];

const EXPIRY_OPTIONS = [
  { value: '24', label: '24時間' },
  { value: '48', label: '48時間' },
  { value: '72', label: '72時間' },
];

// --- Main ---

export function ExternalShareContent({ patientId }: { patientId: string }) {
  const orgId = useOrgId();
  const isBootstrappingOrg = !orgId;
  const [grantedToName, setGrantedToName] = useState('');
  const [grantedToContact, setGrantedToContact] = useState('');
  const [expiryHours, setExpiryHours] = useState('72');
  const [selectedScope, setSelectedScope] = useState<Set<string>>(new Set(['medication_list']));
  const [generated, setGenerated] = useState<GeneratedGrant | null>(null);
  const overviewQuery = useQuery<ExternalShareOverview>({
    queryKey: ['external-share-overview', patientId, orgId],
    enabled: Boolean(patientId && orgId),
    queryFn: async () => {
      const response = await fetch(`/api/patients/${patientId}`, {
        headers: { 'x-org-id': orgId },
        cache: 'no-store',
      });
      if (!response.ok) {
        throw new Error('共有状況を取得できませんでした');
      }

      const payload = (await response.json()) as ExternalShareOverview;
      return {
        external_shares: payload.external_shares ?? [],
        self_reports: payload.self_reports ?? [],
      };
    },
  });

  const generateMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/external-access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-org-id': orgId },
        body: JSON.stringify({
          patient_id: patientId,
          granted_to_name: grantedToName,
          granted_to_contact: grantedToContact || null,
          scope: Object.fromEntries(
            SCOPE_ITEMS.map((item) => [item.key, selectedScope.has(item.key)]),
          ),
          expires_hours: parseInt(expiryHours, 10),
        }),
      });
      if (!res.ok) throw new Error('共有リンクの生成に失敗しました');
      const payload = (await res.json()) as {
        data: {
          token: string;
          otp: string;
          expires_at: string;
          otp_delivery: 'sms' | 'manual';
          otp_delivery_destination: string | null;
        };
      };
      return {
        data: {
          shareUrl: `${window.location.origin}/shared/${payload.data.token}`,
          otp: payload.data.otp,
          expiresAt: payload.data.expires_at,
          otpDelivery: payload.data.otp_delivery,
          otpDeliveryDestination: payload.data.otp_delivery_destination,
        },
      } satisfies { data: GeneratedGrant };
    },
    onSuccess: (result) => {
      setGenerated(result.data);
      toast.success('共有リンクを発行しました');
    },
    onError: () => toast.error('共有リンクの生成に失敗しました'),
  });

  function toggleScope(key: string) {
    setSelectedScope((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  function handleCopyUrl() {
    if (!generated?.shareUrl) return;
    navigator.clipboard
      .writeText(generated.shareUrl)
      .then(() => {
        toast.success('URLをコピーしました');
      })
      .catch(() => {
        toast.error('コピーに失敗しました');
      });
  }

  function handleCopyOtp() {
    if (!generated?.otp) return;
    navigator.clipboard
      .writeText(generated.otp)
      .then(() => {
        toast.success('OTPをコピーしました');
      })
      .catch(() => {
        toast.error('コピーに失敗しました');
      });
  }

  function handleGenerate() {
    if (!grantedToName.trim()) {
      toast.error('共有先氏名は必須です');
      return;
    }
    if (selectedScope.size === 0) {
      toast.error('共有する情報を1つ以上選択してください');
      return;
    }
    generateMutation.mutate();
  }

  if (isBootstrappingOrg || overviewQuery.isLoading) {
    return <Loading />;
  }

  const recentShares = overviewQuery.data?.external_shares ?? [];
  const recentSelfReports = overviewQuery.data?.self_reports ?? [];

  return (
    <div className="max-w-lg space-y-4">
      {/* Warning */}
      <div className="flex items-start gap-3 rounded-md border border-orange-200 bg-orange-50 px-4 py-3 text-sm text-orange-800">
        <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <div>
          <p className="font-medium">個人情報の外部共有には十分注意してください</p>
          <p className="mt-0.5 text-orange-700">
            発行されたリンクは有効期限内に限り閲覧可能です。共有先連絡先に電話番号を入れると OTP を
            SMS 送信し、それ以外は別経路で手動共有します。
          </p>
        </div>
      </div>

      {/* Form */}
      {!generated && (
        <Card>
          <CardHeader>
            <h2 className="font-heading text-base leading-snug font-medium">共有設定</h2>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="granted-to-name">共有先氏名</Label>
              <Input
                id="granted-to-name"
                value={grantedToName}
                onChange={(e) => setGrantedToName(e.target.value)}
                placeholder="例: 田中ケアマネジャー"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="granted-to-contact">共有先連絡先（任意）</Label>
              <Input
                id="granted-to-contact"
                value={grantedToContact}
                onChange={(e) => setGrantedToContact(e.target.value)}
                placeholder="電話番号またはメールアドレス"
              />
            </div>

            <div className="space-y-2">
              <Label>共有する情報</Label>
              {SCOPE_ITEMS.map((item) => (
                <div key={item.key} className="flex items-start gap-2">
                  <Checkbox
                    id={`scope-${item.key}`}
                    checked={selectedScope.has(item.key)}
                    onCheckedChange={() => toggleScope(item.key)}
                  />
                  <label htmlFor={`scope-${item.key}`} className="cursor-pointer space-y-0.5">
                    <span className="text-sm font-medium">{item.label}</span>
                    <p className="text-xs text-muted-foreground">{item.description}</p>
                  </label>
                </div>
              ))}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="expiry">有効期限</Label>
              <Select value={expiryHours} onValueChange={(v) => setExpiryHours(v ?? '72')}>
                <SelectTrigger id="expiry">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EXPIRY_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <ActionRail>
              <Button onClick={handleGenerate} disabled={generateMutation.isPending}>
                <Link2 className="mr-1.5 size-4" aria-hidden="true" />
                {generateMutation.isPending ? '生成中...' : '共有リンクを発行'}
              </Button>
            </ActionRail>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <h2 className="font-heading text-base leading-snug font-medium">
            共有済みリンクと連絡文脈
          </h2>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <p className="text-sm font-medium text-foreground">最近の共有先</p>
            {recentShares.length > 0 ? (
              recentShares.slice(0, 3).map((share) => (
                <div
                  key={share.id}
                  className="rounded-lg border border-border/70 px-3 py-2 text-sm"
                >
                  <p className="font-medium text-foreground">{share.granted_to_name}</p>
                  <p className="text-xs text-muted-foreground">
                    有効期限 {new Date(share.expires_at).toLocaleString('ja-JP')}
                  </p>
                </div>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">共有済みリンクはまだありません。</p>
            )}
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium text-foreground">直近の自己申告・連絡メモ</p>
            {recentSelfReports.length > 0 ? (
              recentSelfReports.slice(0, 3).map((report) => (
                <div
                  key={report.id}
                  className="rounded-lg border border-border/70 px-3 py-2 text-sm"
                >
                  <p className="font-medium text-foreground">{report.subject}</p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(report.created_at).toLocaleString('ja-JP')} / {report.status}
                  </p>
                </div>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">自己申告はまだありません。</p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Generated result */}
      {generated && (
        <Card className="border-green-200">
          <CardHeader>
            <h2 className="flex items-center gap-2 font-heading text-base leading-snug font-medium text-green-800">
              <CheckCircle2 className="size-5" aria-hidden="true" />
              共有リンクを発行しました
            </h2>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label>共有URL</Label>
              <div className="flex items-center gap-2">
                <Input
                  value={generated.shareUrl}
                  readOnly
                  className="font-mono text-xs"
                  aria-label="共有URL"
                />
                <Button
                  size="icon"
                  variant="outline"
                  onClick={handleCopyUrl}
                  aria-label="URLをコピー"
                >
                  <Copy className="size-4" />
                </Button>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>OTP（別経路で伝達）</Label>
              <div className="flex items-center gap-2">
                <Input
                  value={generated.otp}
                  readOnly
                  className="font-mono text-xl tracking-widest text-center"
                  aria-label="OTP"
                />
                <Button
                  size="icon"
                  variant="outline"
                  onClick={handleCopyOtp}
                  aria-label="OTPをコピー"
                >
                  <Copy className="size-4" />
                </Button>
              </div>
            </div>

            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Clock className="size-3.5" aria-hidden="true" />
              有効期限: {new Date(generated.expiresAt).toLocaleString('ja-JP')}
            </div>

            {generated.otpDelivery === 'sms' ? (
              <div className="flex items-start gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                OTP を {generated.otpDeliveryDestination ?? '共有先連絡先'} に SMS
                送信しました。必要に応じて下の控え用 OTP を確認してください。
              </div>
            ) : (
              <div className="flex items-start gap-2 rounded-md border border-orange-200 bg-orange-50 px-3 py-2 text-xs text-orange-800">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                OTPは電話・SMSなど共有URLとは別の手段で伝達してください。
              </div>
            )}

            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => setGenerated(null)}
            >
              新しい共有リンクを発行する
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
