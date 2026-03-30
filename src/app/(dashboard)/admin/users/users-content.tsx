'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type ColumnDef } from '@tanstack/react-table';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DataTable } from '@/components/ui/data-table';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { useOrgId } from '@/lib/hooks/use-org-id';

type UserItem = {
  id: string;
  name: string;
  name_kana: string | null;
  email: string;
  phone: string | null;
  role: string;
  site_id: string | null;
  site_name: string | null;
  is_active: boolean;
  account_status: string;
  invited_at: string | null;
  last_invited_at: string | null;
  activated_at: string | null;
  deactivated_at: string | null;
  deactivation_reason: string | null;
};

type SiteOption = {
  id: string;
  name: string;
};

type InviteForm = {
  name: string;
  name_kana: string;
  email: string;
  phone: string;
  role: string;
  site_id: string;
};

const EMPTY_INVITE: InviteForm = {
  name: '',
  name_kana: '',
  email: '',
  phone: '',
  role: 'pharmacist',
  site_id: '',
};

const ROLE_OPTIONS = [
  ['admin', '管理者'],
  ['pharmacist', '薬剤師'],
  ['pharmacist_trainee', '研修薬剤師'],
  ['clerk', '事務スタッフ'],
  ['driver', '配送担当'],
  ['external_viewer', '外部連携者'],
] as const;

const STATUS_MAP: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  invited: { label: '招待済', variant: 'outline' },
  active: { label: '稼働中', variant: 'default' },
  suspended: { label: '停止中', variant: 'destructive' },
  retired: { label: '退職', variant: 'secondary' },
};

function roleLabel(role: string) {
  return ROLE_OPTIONS.find(([key]) => key === role)?.[1] ?? role;
}

function statusBadge(status: string) {
  const config = STATUS_MAP[status] ?? { label: status, variant: 'outline' as const };
  return <Badge variant={config.variant}>{config.label}</Badge>;
}

export function UsersContent() {
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  const [showInvite, setShowInvite] = useState(false);
  const [inviteForm, setInviteForm] = useState<InviteForm>(EMPTY_INVITE);
  const [actionDialog, setActionDialog] = useState<{
    type: 'suspend' | 'retire' | 'reactivate' | 'resend_invite';
    user: UserItem;
    reason: string;
  } | null>(null);
  const [detailUser, setDetailUser] = useState<UserItem | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['admin-users', orgId],
    queryFn: async () => {
      const response = await fetch('/api/pharmacists?include_collaborators=true', {
        headers: { 'x-org-id': orgId },
      });
      if (!response.ok) throw new Error('ユーザー一覧の取得に失敗しました');
      return response.json() as Promise<{ data: UserItem[] }>;
    },
    enabled: !!orgId,
  });

  const sitesQuery = useQuery({
    queryKey: ['pharmacy-sites', orgId],
    queryFn: async () => {
      const response = await fetch('/api/pharmacy-sites', {
        headers: { 'x-org-id': orgId },
      });
      if (!response.ok) throw new Error('店舗一覧の取得に失敗しました');
      return response.json() as Promise<{ data: SiteOption[] }>;
    },
    enabled: !!orgId,
  });

  const users = data?.data ?? [];
  const sites = sitesQuery.data?.data ?? [];

  const inviteMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/pharmacists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-org-id': orgId },
        body: JSON.stringify({
          ...inviteForm,
          site_id: inviteForm.site_id || undefined,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error((payload as { message?: string }).message ?? '招待に失敗しました');
      }
      return payload;
    },
    onSuccess: async () => {
      toast.success('ユーザーを招待しました');
      setShowInvite(false);
      setInviteForm(EMPTY_INVITE);
      await queryClient.invalidateQueries({ queryKey: ['admin-users', orgId] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : '招待に失敗しました');
    },
  });

  const actionMutation = useMutation({
    mutationFn: async () => {
      if (!actionDialog) throw new Error('操作が選択されていません');
      const body: Record<string, string> = { action: actionDialog.type };
      if (actionDialog.type === 'suspend' || actionDialog.type === 'retire') {
        body.reason = actionDialog.reason;
      }
      const response = await fetch(`/api/pharmacists/${actionDialog.user.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'x-org-id': orgId },
        body: JSON.stringify(body),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error((payload as { message?: string }).message ?? '操作に失敗しました');
      }
      return payload;
    },
    onSuccess: async () => {
      const labels: Record<string, string> = {
        suspend: '停止しました',
        retire: '退職処理しました',
        reactivate: '再有効化しました',
        resend_invite: '招待を再送しました',
      };
      toast.success(labels[actionDialog!.type] ?? '操作を実行しました');
      setActionDialog(null);
      await queryClient.invalidateQueries({ queryKey: ['admin-users', orgId] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : '操作に失敗しました');
    },
  });

  const columns = useMemo<ColumnDef<UserItem>[]>(
    () => [
      {
        accessorKey: 'name',
        header: '氏名',
        cell: ({ row }) => (
          <div className="space-y-0.5">
            <div className="font-medium">{row.original.name}</div>
            <div className="text-xs text-muted-foreground">{row.original.email}</div>
          </div>
        ),
      },
      {
        accessorKey: 'role',
        header: 'ロール',
        cell: ({ row }) => <Badge variant="outline">{roleLabel(row.original.role)}</Badge>,
      },
      {
        accessorKey: 'site_name',
        header: '所属店舗',
        cell: ({ row }) => (
          <span className="text-sm">{row.original.site_name ?? '未設定'}</span>
        ),
      },
      {
        accessorKey: 'account_status',
        header: 'ステータス',
        cell: ({ row }) => statusBadge(row.original.account_status),
      },
      {
        id: 'actions',
        header: '操作',
        cell: ({ row }) => {
          const user = row.original;
          return (
            <div className="flex flex-wrap gap-1">
              <Button size="sm" variant="secondary" onClick={() => setDetailUser(user)}>
                詳細
              </Button>
              {user.account_status === 'invited' && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setActionDialog({ type: 'resend_invite', user, reason: '' })}
                >
                  再送
                </Button>
              )}
              {(user.account_status === 'active' || user.account_status === 'invited') && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setActionDialog({ type: 'suspend', user, reason: '' })}
                >
                  停止
                </Button>
              )}
              {(user.account_status === 'suspended' || user.account_status === 'retired') && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setActionDialog({ type: 'reactivate', user, reason: '' })}
                >
                  復帰
                </Button>
              )}
            </div>
          );
        },
      },
    ],
    []
  );

  const summary = {
    total: users.length,
    active: users.filter((u) => u.account_status === 'active').length,
    invited: users.filter((u) => u.account_status === 'invited').length,
    suspended: users.filter((u) => u.account_status === 'suspended' || u.account_status === 'retired').length,
  };

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-4">
        <SummaryCard label="総ユーザー数" value={summary.total} />
        <SummaryCard label="稼働中" value={summary.active} />
        <SummaryCard label="招待済（未承認）" value={summary.invited} />
        <SummaryCard label="停止/退職" value={summary.suspended} />
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">ユーザー一覧</CardTitle>
          <Button onClick={() => setShowInvite(true)}>ユーザーを招待</Button>
        </CardHeader>
        <CardContent className="p-0">
          <DataTable columns={columns} data={users} isLoading={isLoading} caption="ユーザー一覧" />
        </CardContent>
      </Card>

      {/* Invite Sheet */}
      <Sheet open={showInvite} onOpenChange={setShowInvite}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>ユーザーを招待</SheetTitle>
            <SheetDescription>Cognito 経由で招待メールが送信されます。</SheetDescription>
          </SheetHeader>
          <div className="mt-6 space-y-4">
            <Field label="氏名">
              <Input
                value={inviteForm.name}
                onChange={(e) => setInviteForm((f) => ({ ...f, name: e.target.value }))}
              />
            </Field>
            <Field label="フリガナ">
              <Input
                value={inviteForm.name_kana}
                onChange={(e) => setInviteForm((f) => ({ ...f, name_kana: e.target.value }))}
              />
            </Field>
            <Field label="メールアドレス">
              <Input
                type="email"
                value={inviteForm.email}
                onChange={(e) => setInviteForm((f) => ({ ...f, email: e.target.value }))}
              />
            </Field>
            <Field label="電話番号">
              <Input
                value={inviteForm.phone}
                onChange={(e) => setInviteForm((f) => ({ ...f, phone: e.target.value }))}
              />
            </Field>
            <Field label="ロール">
              <Select
                value={inviteForm.role}
                onValueChange={(v) => setInviteForm((f) => ({ ...f, role: v ?? '' }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLE_OPTIONS.map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="所属店舗">
              <Select
                value={inviteForm.site_id}
                onValueChange={(v) => setInviteForm((f) => ({ ...f, site_id: v ?? '' }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="選択してください" />
                </SelectTrigger>
                <SelectContent>
                  {sites.map((site) => (
                    <SelectItem key={site.id} value={site.id}>
                      {site.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <div className="flex justify-end gap-2 pt-4">
              <Button variant="outline" onClick={() => setShowInvite(false)}>
                キャンセル
              </Button>
              <Button
                onClick={() => inviteMutation.mutate()}
                disabled={inviteMutation.isPending || !inviteForm.name || !inviteForm.email}
              >
                {inviteMutation.isPending ? '招待中...' : '招待する'}
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* Detail Sheet */}
      <Sheet open={!!detailUser} onOpenChange={(open) => !open && setDetailUser(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>ユーザー詳細</SheetTitle>
            <SheetDescription>アカウント情報とCognito同期状態を確認できます。</SheetDescription>
          </SheetHeader>
          {detailUser && (
            <div className="mt-6 space-y-4">
              <DetailField label="氏名" value={detailUser.name} />
              <DetailField label="フリガナ" value={detailUser.name_kana} />
              <DetailField label="メールアドレス" value={detailUser.email} />
              <DetailField label="電話番号" value={detailUser.phone} />
              <DetailField label="ロール" value={roleLabel(detailUser.role)} />
              <DetailField label="所属店舗" value={detailUser.site_name} />
              <div>
                <div className="text-xs text-muted-foreground">ステータス</div>
                <div className="mt-1">{statusBadge(detailUser.account_status)}</div>
              </div>
              <DetailField
                label="招待日"
                value={detailUser.invited_at ? new Date(detailUser.invited_at).toLocaleDateString('ja-JP') : null}
              />
              <DetailField
                label="最終招待日"
                value={detailUser.last_invited_at ? new Date(detailUser.last_invited_at).toLocaleDateString('ja-JP') : null}
              />
              <DetailField
                label="有効化日"
                value={detailUser.activated_at ? new Date(detailUser.activated_at).toLocaleDateString('ja-JP') : null}
              />
              {detailUser.deactivated_at && (
                <>
                  <DetailField
                    label="停止日"
                    value={new Date(detailUser.deactivated_at).toLocaleDateString('ja-JP')}
                  />
                  <DetailField label="停止理由" value={detailUser.deactivation_reason} />
                </>
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* Action Dialog */}
      <Dialog open={!!actionDialog} onOpenChange={(open) => !open && setActionDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {actionDialog?.type === 'suspend' && 'ユーザーを停止'}
              {actionDialog?.type === 'retire' && 'ユーザーを退職処理'}
              {actionDialog?.type === 'reactivate' && 'ユーザーを再有効化'}
              {actionDialog?.type === 'resend_invite' && '招待を再送'}
            </DialogTitle>
            <DialogDescription>
              {actionDialog?.user.name} ({actionDialog?.user.email}) に対する操作です。
            </DialogDescription>
          </DialogHeader>
          {(actionDialog?.type === 'suspend' || actionDialog?.type === 'retire') && (
            <div className="py-2">
              <Label className="mb-1.5 block">理由</Label>
              <Textarea
                value={actionDialog.reason}
                onChange={(e) =>
                  setActionDialog((prev) => prev ? { ...prev, reason: e.target.value } : null)
                }
                placeholder="停止・退職理由を入力してください"
              />
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setActionDialog(null)}>
              キャンセル
            </Button>
            <Button
              variant={actionDialog?.type === 'suspend' || actionDialog?.type === 'retire' ? 'destructive' : 'default'}
              onClick={() => actionMutation.mutate()}
              disabled={
                actionMutation.isPending ||
                ((actionDialog?.type === 'suspend' || actionDialog?.type === 'retire') && !actionDialog?.reason.trim())
              }
            >
              {actionMutation.isPending ? '処理中...' : '実行'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardContent>
        <div className="text-sm text-muted-foreground">{label}</div>
        <div className="mt-2 text-3xl font-semibold">{value}</div>
      </CardContent>
    </Card>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <Label className="mb-1.5 block">{label}</Label>
      {children}
    </div>
  );
}

function DetailField({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-sm">{value?.trim() ? value : '未設定'}</div>
    </div>
  );
}
