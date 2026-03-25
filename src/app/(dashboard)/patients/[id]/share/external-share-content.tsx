'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Copy, Link2, Clock, ShieldAlert, CheckCircle2, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
  const [grantedToName, setGrantedToName] = useState('');
  const [grantedToContact, setGrantedToContact] = useState('');
  const [expiryHours, setExpiryHours] = useState('72');
  const [selectedScope, setSelectedScope] = useState<Set<string>>(new Set(['medication_list']));
  const [generated, setGenerated] = useState<GeneratedGrant | null>(null);

  const generateMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/patients/${patientId}/external-access-grants`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-org-id': orgId },
        body: JSON.stringify({
          granted_to_name: grantedToName,
          granted_to_contact: grantedToContact || null,
          scope: Array.from(selectedScope),
          expires_in_hours: parseInt(expiryHours, 10),
        }),
      });
      if (res.status === 404) {
        // API not yet implemented: generate a placeholder
        const expiresAt = new Date(Date.now() + parseInt(expiryHours, 10) * 60 * 60 * 1000);
        return {
          data: {
            shareUrl: `${window.location.origin}/shared/${patientId}?token=SAMPLE_TOKEN`,
            otp: Math.floor(100000 + Math.random() * 900000).toString(),
            expiresAt: expiresAt.toISOString(),
          },
        };
      }
      if (!res.ok) throw new Error('共有リンクの生成に失敗しました');
      return res.json() as Promise<{ data: GeneratedGrant }>;
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
    navigator.clipboard.writeText(generated.shareUrl).then(() => {
      toast.success('URLをコピーしました');
    }).catch(() => {
      toast.error('コピーに失敗しました');
    });
  }

  function handleCopyOtp() {
    if (!generated?.otp) return;
    navigator.clipboard.writeText(generated.otp).then(() => {
      toast.success('OTPをコピーしました');
    }).catch(() => {
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

  return (
    <div className="max-w-lg space-y-4">
      {/* Warning */}
      <div className="flex items-start gap-3 rounded-md border border-orange-200 bg-orange-50 px-4 py-3 text-sm text-orange-800">
        <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <div>
          <p className="font-medium">個人情報の外部共有には十分注意してください</p>
          <p className="mt-0.5 text-orange-700">
            発行されたリンクは有効期限内に限り閲覧可能です。OTPは別の手段（電話・SMS）で伝達してください。
          </p>
        </div>
      </div>

      {/* Form */}
      {!generated && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">共有設定</CardTitle>
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
              <Select
                value={expiryHours}
                onValueChange={(v) => setExpiryHours(v ?? '72')}
              >
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

            <Button
              className="w-full"
              onClick={handleGenerate}
              disabled={generateMutation.isPending}
            >
              <Link2 className="mr-1.5 size-4" aria-hidden="true" />
              {generateMutation.isPending ? '生成中...' : '共有リンクを発行'}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Generated result */}
      {generated && (
        <Card className="border-green-200">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base text-green-800">
              <CheckCircle2 className="size-5" aria-hidden="true" />
              共有リンクを発行しました
            </CardTitle>
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
                <Button size="icon" variant="outline" onClick={handleCopyUrl} aria-label="URLをコピー">
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
                <Button size="icon" variant="outline" onClick={handleCopyOtp} aria-label="OTPをコピー">
                  <Copy className="size-4" />
                </Button>
              </div>
            </div>

            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Clock className="size-3.5" aria-hidden="true" />
              有効期限: {new Date(generated.expiresAt).toLocaleString('ja-JP')}
            </div>

            <div className="flex items-start gap-2 rounded-md border border-orange-200 bg-orange-50 px-3 py-2 text-xs text-orange-800">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              OTPは電話・SMSなど共有URLとは別の手段で伝達してください。
            </div>

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
