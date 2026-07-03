'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { KeyRound, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { StateBadge } from '@/components/ui/state-badge';
import { Textarea } from '@/components/ui/textarea';
import { PlatformApiError, platformFetchJson } from '../../platform-fetch';
import { PLATFORM_TENANTS_QUERY_KEY } from '../../tenant-directory-content';
import {
  BREAK_GLASS_SESSIONS_QUERY_KEY,
  findActiveSessionForOrg,
  useBreakGlassSessions,
  type BreakGlassSessionSummary,
} from '../../use-break-glass-sessions';
import { useRemainingMinutesLabel } from '../../use-remaining-minutes-label';

const MIN_REASON_LENGTH = 10;

type BreakGlassScope = 'read_only' | 'read_write';

type ActivatePayload = {
  targetOrgId: string;
  reason: string;
  referenceTicket?: string;
  scope: BreakGlassScope;
  password: string;
  mfaCode: string;
};

type FieldErrors = Partial<Record<'reason' | 'password' | 'mfaCode', string>>;

function ActiveSessionCard({
  session,
  tenantName,
}: {
  session: BreakGlassSessionSummary;
  tenantName?: string;
}) {
  const queryClient = useQueryClient();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const remainingLabel = useRemainingMinutesLabel(session.expires_at);

  const revokeMutation = useMutation({
    mutationFn: () =>
      platformFetchJson(`/api/platform/break-glass/${session.id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: BREAK_GLASS_SESSIONS_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: PLATFORM_TENANTS_QUERY_KEY });
      toast.success('ブレークグラスセッションを終了しました');
    },
    onError: (err) => {
      const message =
        err instanceof PlatformApiError ? err.message : 'セッション終了に失敗しました';
      toast.error(message);
    },
  });

  return (
    <Card className="border-tag-hazard/30">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          <ShieldCheck className="size-4 text-tag-hazard" aria-hidden="true" />
          <span>アクティブなブレークグラスセッション</span>
          <StateBadge role={session.scope === 'read_write' ? 'hazard' : 'readonly'}>
            {session.scope === 'read_write' ? '読み書き' : '読み取り専用'}
          </StateBadge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <dl className="grid gap-2 sm:grid-cols-2">
          <div>
            <dt className="text-xs text-muted-foreground">残り時間</dt>
            <dd className="font-medium tabular-nums">{remainingLabel}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">理由</dt>
            <dd className="break-words">{session.reason}</dd>
          </div>
          {session.reference_ticket ? (
            <div>
              <dt className="text-xs text-muted-foreground">参照チケット</dt>
              <dd>{session.reference_ticket}</dd>
            </div>
          ) : null}
        </dl>
        <Button
          type="button"
          variant="destructive"
          size="sm"
          className="min-h-[44px] sm:min-h-0"
          onClick={() => setConfirmOpen(true)}
          disabled={revokeMutation.isPending}
        >
          セッションを終了（revoke）
        </Button>
        <ConfirmDialog
          open={confirmOpen}
          onOpenChange={setConfirmOpen}
          variant="destructive"
          title="ブレークグラスセッションを終了しますか"
          description={`${tenantName ?? 'このテナント'}への越権アクセスを直ちに終了します。この操作も監査に記録されます。`}
          confirmLabel="終了する"
          onConfirm={() => revokeMutation.mutate()}
        />
      </CardContent>
    </Card>
  );
}

export function BreakGlassPanel({ orgId, tenantName }: { orgId: string; tenantName?: string }) {
  const queryClient = useQueryClient();
  const { data, isLoading, isError, refetch } = useBreakGlassSessions();

  const [reason, setReason] = useState('');
  const [referenceTicket, setReferenceTicket] = useState('');
  const [scope, setScope] = useState<BreakGlassScope>('read_only');
  const [password, setPassword] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const activateMutation = useMutation({
    mutationFn: (payload: ActivatePayload) =>
      platformFetchJson<{ session: BreakGlassSessionSummary }>('/api/platform/break-glass', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: BREAK_GLASS_SESSIONS_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: PLATFORM_TENANTS_QUERY_KEY });
      toast.success('ブレークグラスセッションを起動しました');
      setReason('');
      setReferenceTicket('');
      setScope('read_only');
      setPassword('');
      setMfaCode('');
      setFormError(null);
    },
    onError: (err) => {
      const message = err instanceof PlatformApiError ? err.message : 'アクセス起動に失敗しました';
      setFormError(message);
    },
  });

  function validate(): boolean {
    const errors: FieldErrors = {};
    if (reason.trim().length < MIN_REASON_LENGTH) {
      errors.reason = `アクセス理由を${MIN_REASON_LENGTH}文字以上で入力してください`;
    }
    if (!password) {
      errors.password = 'パスワードを入力してください';
    }
    if (!mfaCode.trim()) {
      errors.mfaCode = 'MFAコードを入力してください';
    }
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    if (!validate()) return;
    setConfirmOpen(true);
  }

  function handleConfirmActivate() {
    activateMutation.mutate({
      targetOrgId: orgId,
      reason: reason.trim(),
      referenceTicket: referenceTicket.trim() || undefined,
      scope,
      password,
      mfaCode: mfaCode.trim(),
    });
  }

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-6 text-sm text-muted-foreground">
          ブレークグラスセッションを確認しています...
        </CardContent>
      </Card>
    );
  }

  if (isError) {
    return (
      <Card className="border-destructive/30">
        <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4 text-sm text-destructive">
          <span>ブレークグラスセッションの状態を取得できませんでした。</span>
          <Button type="button" variant="outline" size="sm" onClick={() => refetch()}>
            再試行
          </Button>
        </CardContent>
      </Card>
    );
  }

  const activeSession = findActiveSessionForOrg(data?.sessions, orgId);

  if (activeSession) {
    return <ActiveSessionCard session={activeSession} tenantName={tenantName} />;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <KeyRound className="size-4" aria-hidden="true" />
          ブレークグラスアクセスを起動
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form className="space-y-4" onSubmit={handleSubmit} noValidate>
          <p className="text-sm text-muted-foreground">
            対象テナント: <span className="font-medium text-foreground">{tenantName ?? orgId}</span>
          </p>

          <div className="space-y-1.5">
            <Label htmlFor="break-glass-reason">
              アクセス理由 <span className="text-destructive">*</span>
            </Label>
            <Textarea
              id="break-glass-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="例: 障害調査チケット #1234 のため、該当テナントのデータを確認します"
              rows={3}
              aria-invalid={Boolean(fieldErrors.reason)}
              aria-describedby={fieldErrors.reason ? 'break-glass-reason-error' : undefined}
            />
            {fieldErrors.reason ? (
              <p id="break-glass-reason-error" role="alert" className="text-xs text-destructive">
                {fieldErrors.reason}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                {MIN_REASON_LENGTH}文字以上で入力してください
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="break-glass-ticket">参照チケット（任意）</Label>
            <Input
              id="break-glass-ticket"
              value={referenceTicket}
              onChange={(e) => setReferenceTicket(e.target.value)}
              placeholder="例: SUP-1234"
              className="min-h-[44px] sm:h-11 sm:min-h-[44px]"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="break-glass-scope">アクセス範囲</Label>
            <Select
              value={scope}
              onValueChange={(v) => setScope((v as BreakGlassScope) ?? 'read_only')}
            >
              <SelectTrigger
                id="break-glass-scope"
                className="min-h-[44px] w-full sm:h-11 sm:min-h-[44px]"
              >
                <SelectValue>
                  {scope === 'read_write' ? '読み書き（read_write）' : '読み取り専用（read_only）'}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="read_only">読み取り専用（read_only）</SelectItem>
                <SelectItem value="read_write">読み書き（read_write・上位権限が必要）</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              既定は読み取り専用です。読み書きは権限のある運営者のみ許可されます。
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="break-glass-password">
                パスワード（再認証） <span className="text-destructive">*</span>
              </Label>
              <Input
                id="break-glass-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="min-h-[44px] sm:h-11 sm:min-h-[44px]"
                aria-invalid={Boolean(fieldErrors.password)}
                aria-describedby={fieldErrors.password ? 'break-glass-password-error' : undefined}
              />
              {fieldErrors.password ? (
                <p
                  id="break-glass-password-error"
                  role="alert"
                  className="text-xs text-destructive"
                >
                  {fieldErrors.password}
                </p>
              ) : null}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="break-glass-mfa">
                MFAコード <span className="text-destructive">*</span>
              </Label>
              <Input
                id="break-glass-mfa"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={8}
                value={mfaCode}
                onChange={(e) => setMfaCode(e.target.value)}
                className="min-h-[44px] sm:h-11 sm:min-h-[44px]"
                aria-invalid={Boolean(fieldErrors.mfaCode)}
                aria-describedby={fieldErrors.mfaCode ? 'break-glass-mfa-error' : undefined}
              />
              {fieldErrors.mfaCode ? (
                <p id="break-glass-mfa-error" role="alert" className="text-xs text-destructive">
                  {fieldErrors.mfaCode}
                </p>
              ) : null}
            </div>
          </div>

          {formError ? (
            <p role="alert" className="text-sm text-destructive">
              {formError}
            </p>
          ) : null}

          <Button
            type="submit"
            variant="destructive"
            className="min-h-[44px] sm:min-h-0"
            disabled={activateMutation.isPending}
          >
            アクセスを起動
          </Button>
        </form>

        <ConfirmDialog
          open={confirmOpen}
          onOpenChange={setConfirmOpen}
          variant="destructive"
          title="ブレークグラスアクセスを起動しますか"
          description={`${tenantName ?? 'このテナント'}への越権アクセスを起動します。全操作が監査ログに記録されます。`}
          confirmLabel="起動する"
          onConfirm={handleConfirmActivate}
        />
      </CardContent>
    </Card>
  );
}
