'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type ColumnDef } from '@tanstack/react-table';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DataTable } from '@/components/ui/data-table';
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
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { StateBadge } from '@/components/ui/state-badge';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { USER_ACCOUNT_STATUS_ROLE } from '@/lib/constants/status-labels';
import { formatDateTimeLabel } from '@/lib/ui/date-format';
import {
  isOperationalMemberRole,
  roleRequiresSite,
  type ManageableMemberRole,
} from '@/lib/auth/member-roles';
import { useOrgId } from '@/lib/hooks/use-org-id';

type UserItem = {
  id: string;
  cognito_linked: boolean;
  name: string;
  name_kana: string | null;
  email: string;
  phone: string | null;
  role: ManageableMemberRole | 'owner';
  site_id: string | null;
  site_name: string | null;
  is_active: boolean;
  account_status: string;
  invited_at: string | null;
  last_invited_at: string | null;
  activated_at: string | null;
  deactivated_at: string | null;
  deactivation_reason: string | null;
  last_active_at: string | null;
  max_daily_visits: number | null;
  max_weekly_visits: number | null;
  max_travel_minutes: number | null;
  can_accept_emergency: boolean;
  visit_specialties: string[] | null;
  coverage_area: string[] | null;
  can_dispense: boolean;
  can_audit_dispense: boolean;
  can_set: boolean;
  can_audit_set: boolean;
  credential_types: string[];
  monthly_visit_count: number;
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
  role: ManageableMemberRole;
  site_id: string;
};

type DetailForm = {
  name: string;
  name_kana: string;
  phone: string;
  role: ManageableMemberRole;
  site_id: string;
  max_daily_visits: string;
  max_weekly_visits: string;
  max_travel_minutes: string;
  can_accept_emergency: boolean;
  visit_specialties: string;
  coverage_area: string;
  can_dispense: boolean;
  can_audit_dispense: boolean;
  can_set: boolean;
  can_audit_set: boolean;
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
] as const satisfies ReadonlyArray<readonly [ManageableMemberRole, string]>;

const VISIT_LIMITS = {
  max_daily_visits: { label: '日次上限', min: 1, max: 20, unit: '件' },
  max_weekly_visits: { label: '週次上限', min: 1, max: 100, unit: '件' },
  max_travel_minutes: { label: '移動上限', min: 0, max: 480, unit: '分' },
} as const;

const VISIT_CONSTRAINT_DISABLED_HELP_ID = 'detail-visit-constraints-role-help';
const DETAIL_SAVE_BLOCKER_ID = 'detail-user-save-blocker';

type VisitLimitKey = keyof typeof VISIT_LIMITS;

// アカウント状態の表示ラベル(下段フィルタ Select と statusBadge で共用)。
// 色は variant 直書きをやめ USER_ACCOUNT_STATUS_ROLE(6軸トークン SSOT)へ寄せる。
const STATUS_MAP: Record<string, { label: string }> = {
  pending_cognito: { label: 'Cognito連携待ち' },
  invited: { label: '招待済' },
  active: { label: '稼働中' },
  suspended: { label: '停止中' },
  retired: { label: '退職' },
  cognito_failed: { label: '連携失敗' },
};

function roleLabel(role: string) {
  return ROLE_OPTIONS.find(([key]) => key === role)?.[1] ?? role;
}

function statusBadge(status: string) {
  const label = STATUS_MAP[status]?.label ?? status;
  const role = USER_ACCOUNT_STATUS_ROLE[status];
  // 赤(blocked)は suspended/cognito_failed のみ。waiting/done/readonly は各トークンへ。
  // role 未定義/neutral は状態色を付けず中立 outline Badge に逃がす(偽シグナル回避)。
  if (role && role !== 'neutral') {
    return <StateBadge role={role}>{label}</StateBadge>;
  }
  return <Badge variant="outline">{label}</Badge>;
}

function formatListInput(values: string[] | null | undefined) {
  return values?.join('\n') ?? '';
}

function parseListInput(value: string) {
  return value
    .split(/\r?\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function toOptionalNumber(value: string) {
  if (!value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function descriptionIds(...ids: Array<string | false | null | undefined>) {
  const value = ids.filter(Boolean).join(' ');
  return value || undefined;
}

function validateVisitLimit(key: VisitLimitKey, value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const parsed = Number(trimmed);
  const limit = VISIT_LIMITS[key];
  if (!Number.isInteger(parsed) || parsed < limit.min || parsed > limit.max) {
    return `${limit.label}は${limit.min}〜${limit.max}${limit.unit}の整数で入力してください。`;
  }
  return null;
}

function getVisitLimitErrors(form: DetailForm | null, enabled: boolean) {
  if (!form || !enabled) return {};
  return {
    max_daily_visits: validateVisitLimit('max_daily_visits', form.max_daily_visits),
    max_weekly_visits: validateVisitLimit('max_weekly_visits', form.max_weekly_visits),
    max_travel_minutes: validateVisitLimit('max_travel_minutes', form.max_travel_minutes),
  };
}

function getDetailSaveBlocker(
  form: DetailForm | null,
  siteRequired: boolean,
  visitLimitError?: string,
) {
  if (!form) return null;
  if (!form.name.trim()) return '氏名を入力してください。';
  if (!form.name_kana.trim()) return 'フリガナを入力してください。';
  if (siteRequired && !form.site_id) return '所属店舗を選択してください。';
  return visitLimitError ?? null;
}

function buildDetailForm(user: UserItem): DetailForm {
  return {
    name: user.name,
    name_kana: user.name_kana ?? '',
    phone: user.phone ?? '',
    role: user.role === 'owner' ? 'admin' : user.role,
    site_id: user.site_id ?? '',
    max_daily_visits: user.max_daily_visits?.toString() ?? '',
    max_weekly_visits: user.max_weekly_visits?.toString() ?? '',
    max_travel_minutes: user.max_travel_minutes?.toString() ?? '',
    can_accept_emergency: user.can_accept_emergency,
    visit_specialties: formatListInput(user.visit_specialties),
    coverage_area: formatListInput(user.coverage_area),
    can_dispense: user.can_dispense,
    can_audit_dispense: user.can_audit_dispense,
    can_set: user.can_set,
    can_audit_set: user.can_audit_set,
  };
}

export function UsersContent() {
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  const [showInvite, setShowInvite] = useState(false);
  const [inviteForm, setInviteForm] = useState<InviteForm>(EMPTY_INVITE);
  const [detailUser, setDetailUser] = useState<UserItem | null>(null);
  const [detailForm, setDetailForm] = useState<DetailForm | null>(null);
  const [actionDialog, setActionDialog] = useState<{
    type: 'suspend' | 'retire' | 'reactivate' | 'resend_invite';
    user: UserItem;
    reason: string;
  } | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [roleFilter, setRoleFilter] = useState<'all' | ManageableMemberRole>('all');
  const [siteFilter, setSiteFilter] = useState<'all' | string>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | string>('all');
  const [credentialFilter, setCredentialFilter] = useState<'all' | string>('all');

  const { data, isLoading, isError, refetch } = useQuery({
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

  const users = useMemo(() => data?.data ?? [], [data]);
  const sites = useMemo(() => sitesQuery.data?.data ?? [], [sitesQuery.data]);
  const credentialOptions = useMemo(
    () =>
      Array.from(new Set(users.flatMap((user) => user.credential_types))).sort((left, right) =>
        left.localeCompare(right, 'ja'),
      ),
    [users],
  );

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

  const detailMutation = useMutation({
    mutationFn: async () => {
      if (!detailUser || !detailForm) throw new Error('編集対象がありません');

      const response = await fetch(`/api/pharmacists/${detailUser.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'x-org-id': orgId },
        body: JSON.stringify({
          action: 'update',
          name: detailForm.name,
          name_kana: detailForm.name_kana,
          phone: detailForm.phone || undefined,
          role: detailForm.role,
          site_id: detailForm.site_id || undefined,
          max_daily_visits: toOptionalNumber(detailForm.max_daily_visits),
          max_weekly_visits: toOptionalNumber(detailForm.max_weekly_visits),
          max_travel_minutes: toOptionalNumber(detailForm.max_travel_minutes),
          can_accept_emergency: detailForm.can_accept_emergency,
          visit_specialties: parseListInput(detailForm.visit_specialties),
          coverage_area: parseListInput(detailForm.coverage_area),
          can_dispense: detailForm.can_dispense,
          can_audit_dispense: detailForm.can_audit_dispense,
          can_set: detailForm.can_set,
          can_audit_set: detailForm.can_audit_set,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error((payload as { message?: string }).message ?? '更新に失敗しました');
      }
      return payload;
    },
    onSuccess: async () => {
      toast.success('ユーザー情報を更新しました');
      setDetailUser(null);
      await queryClient.invalidateQueries({ queryKey: ['admin-users', orgId] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : '更新に失敗しました');
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

  const filteredUsers = useMemo(() => {
    const keyword = searchTerm.trim().toLowerCase();
    return users.filter((user) => {
      if (roleFilter !== 'all' && user.role !== roleFilter) return false;
      if (siteFilter !== 'all' && (user.site_id ?? '') !== siteFilter) return false;
      if (statusFilter !== 'all' && user.account_status !== statusFilter) return false;
      if (credentialFilter !== 'all' && !user.credential_types.includes(credentialFilter)) {
        return false;
      }
      if (!keyword) return true;

      return [
        user.name,
        user.name_kana ?? '',
        user.email,
        user.site_name ?? '',
        roleLabel(user.role),
      ]
        .join(' ')
        .toLowerCase()
        .includes(keyword);
    });
  }, [credentialFilter, roleFilter, searchTerm, siteFilter, statusFilter, users]);

  const columns: ColumnDef<UserItem>[] = [
    {
      accessorKey: 'name',
      header: '氏名',
      cell: ({ row }) => (
        <div className="space-y-0.5">
          <div className="font-medium">{row.original.name}</div>
          <div className="text-xs text-muted-foreground">
            {row.original.name_kana ?? 'フリガナ未設定'}
          </div>
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
      cell: ({ row }) => <span className="text-sm">{row.original.site_name ?? '未設定'}</span>,
    },
    {
      accessorKey: 'credential_types',
      header: '資格',
      cell: ({ row }) => {
        if (row.original.credential_types.length === 0) {
          return <span className="text-xs text-muted-foreground">未登録</span>;
        }
        return (
          <div className="flex flex-wrap gap-1">
            {row.original.credential_types.slice(0, 2).map((type) => (
              <Badge key={type} variant="secondary" className="max-w-36 truncate">
                {type}
              </Badge>
            ))}
            {row.original.credential_types.length > 2 ? (
              <Badge variant="outline">+{row.original.credential_types.length - 2}</Badge>
            ) : null}
          </div>
        );
      },
    },
    {
      accessorKey: 'monthly_visit_count',
      header: '今月訪問',
      cell: ({ row }) => (
        <span className="text-sm tabular-nums">{row.original.monthly_visit_count}件</span>
      ),
    },
    {
      accessorKey: 'account_status',
      header: 'ステータス',
      cell: ({ row }) => statusBadge(row.original.account_status),
    },
    {
      accessorKey: 'last_active_at',
      header: '最終アクティブ',
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground">
          {formatDateTimeLabel(row.original.last_active_at, { fallback: '未記録' })}
        </span>
      ),
    },
    {
      id: 'actions',
      header: '操作',
      cell: ({ row }) => {
        const user = row.original;
        return (
          <div className="flex flex-wrap gap-1">
            <Button
              size="sm"
              variant="secondary"
              className="min-h-[44px] sm:min-h-[44px]"
              aria-label={`${user.name}の詳細を開く`}
              onClick={() => openDetail(user)}
            >
              詳細
            </Button>
            {user.account_status === 'invited' ? (
              <Button
                size="sm"
                variant="outline"
                className="min-h-[44px] sm:min-h-[44px]"
                aria-label={`${user.name}に招待を再送`}
                onClick={() => setActionDialog({ type: 'resend_invite', user, reason: '' })}
              >
                再送
              </Button>
            ) : null}
            {user.account_status === 'active' || user.account_status === 'invited' ? (
              <Button
                size="sm"
                variant="outline"
                className="min-h-[44px] sm:min-h-[44px]"
                aria-label={`${user.name}を停止`}
                onClick={() => setActionDialog({ type: 'suspend', user, reason: '' })}
              >
                停止
              </Button>
            ) : null}
            {user.account_status === 'suspended' || user.account_status === 'retired' ? (
              <Button
                size="sm"
                variant="outline"
                className="min-h-[44px] sm:min-h-[44px]"
                aria-label={`${user.name}を復帰`}
                onClick={() => setActionDialog({ type: 'reactivate', user, reason: '' })}
              >
                復帰
              </Button>
            ) : null}
          </div>
        );
      },
    },
  ];

  const summary = {
    total: users.length,
    active: users.filter((user) => user.account_status === 'active').length,
    invited: users.filter((user) => user.account_status === 'invited').length,
    suspended: users.filter(
      (user) => user.account_status === 'suspended' || user.account_status === 'retired',
    ).length,
  };
  const userCountsUnavailable = (isLoading || isError) && !data;

  const operationalRole = detailForm ? isOperationalMemberRole(detailForm.role) : false;
  const siteRequired = detailForm ? roleRequiresSite(detailForm.role) : false;
  const visitLimitErrors = getVisitLimitErrors(detailForm, operationalRole);
  const firstVisitLimitError =
    visitLimitErrors.max_daily_visits ??
    visitLimitErrors.max_weekly_visits ??
    visitLimitErrors.max_travel_minutes ??
    undefined;
  const detailSaveBlocker = getDetailSaveBlocker(detailForm, siteRequired, firstVisitLimitError);

  function openDetail(user: UserItem) {
    setDetailUser(user);
    setDetailForm(buildDetailForm(user));
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-1">
            <CardTitle className="text-base">ユーザー一覧</CardTitle>
            <p className="hidden text-sm text-muted-foreground sm:block">
              招待、権限、停止状態を一覧で確認し、必要なユーザーだけ詳細を開きます。
            </p>
          </div>
          <Button className="min-h-[44px] sm:min-h-[44px]" onClick={() => setShowInvite(true)}>
            ユーザーを招待
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          <Field label="検索" htmlFor="user-filter-search">
            <Input
              id="user-filter-search"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="氏名・メール・店舗で検索"
              className="min-h-[44px] sm:min-h-[44px]"
            />
          </Field>

          <div className="-mx-4 border-t border-border/70 pt-1 sm:-mx-6">
            <DataTable
              columns={columns}
              data={filteredUsers}
              isLoading={isLoading}
              errorMessage={isError ? 'ユーザー一覧を取得できませんでした' : undefined}
              onRetry={() => void refetch()}
              caption="ユーザー一覧"
            />
          </div>

          <div className="flex flex-wrap gap-2 rounded-xl border border-border/70 bg-background/70 px-3 py-3">
            {[
              ['総ユーザー数', userCountsUnavailable ? '—' : summary.total],
              ['稼働中', userCountsUnavailable ? '—' : summary.active],
              ['招待済', userCountsUnavailable ? '—' : summary.invited],
              ['停止/退職', userCountsUnavailable ? '—' : summary.suspended],
            ].map(([label, value]) => (
              <Badge key={label} variant="outline" className="min-h-7 rounded-full px-3">
                {label}: <span className="font-semibold tabular-nums">{value}</span>
              </Badge>
            ))}
          </div>

          <details className="group rounded-xl border border-border/70 bg-background/60 px-3 py-2">
            <summary className="flex min-h-[44px] cursor-pointer items-center justify-between gap-3 text-sm font-medium text-foreground">
              詳細フィルタ
              <span className="text-xs text-muted-foreground">
                ロール・店舗・状態・資格で絞り込み
              </span>
            </summary>
            <div className="grid gap-3 pt-3 md:grid-cols-2 xl:grid-cols-4">
              <Field label="ロール" htmlFor="user-filter-role">
                <Select
                  value={roleFilter}
                  onValueChange={(value) =>
                    setRoleFilter((value as 'all' | ManageableMemberRole) ?? 'all')
                  }
                >
                  <SelectTrigger id="user-filter-role" className="min-h-[44px] sm:min-h-[44px]">
                    {/* Radix は既定値ラベルを SSR 解決できず生 enum を出すため表示文言を明示 */}
                    <SelectValue>
                      {roleFilter === 'all'
                        ? 'すべて'
                        : (ROLE_OPTIONS.find(([value]) => value === roleFilter)?.[1] ?? roleFilter)}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all" className="min-h-[44px]">
                      すべて
                    </SelectItem>
                    {ROLE_OPTIONS.map(([value, label]) => (
                      <SelectItem key={value} value={value} className="min-h-[44px]">
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="所属店舗" htmlFor="user-filter-site">
                <Select value={siteFilter} onValueChange={(value) => setSiteFilter(value ?? 'all')}>
                  <SelectTrigger id="user-filter-site" className="min-h-[44px] sm:min-h-[44px]">
                    <SelectValue>
                      {siteFilter === 'all'
                        ? 'すべて'
                        : (sites.find((site) => site.id === siteFilter)?.name ?? siteFilter)}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all" className="min-h-[44px]">
                      すべて
                    </SelectItem>
                    {sites.map((site) => (
                      <SelectItem key={site.id} value={site.id} className="min-h-[44px]">
                        {site.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="状態" htmlFor="user-filter-status">
                <Select
                  value={statusFilter}
                  onValueChange={(value) => setStatusFilter(value ?? 'all')}
                >
                  <SelectTrigger id="user-filter-status" className="min-h-[44px] sm:min-h-[44px]">
                    <SelectValue>
                      {statusFilter === 'all'
                        ? 'すべて'
                        : (STATUS_MAP[statusFilter as keyof typeof STATUS_MAP]?.label ??
                          statusFilter)}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all" className="min-h-[44px]">
                      すべて
                    </SelectItem>
                    {Object.entries(STATUS_MAP).map(([value, config]) => (
                      <SelectItem key={value} value={value} className="min-h-[44px]">
                        {config.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="資格" htmlFor="user-filter-credential">
                <Select
                  value={credentialFilter}
                  onValueChange={(value) => setCredentialFilter(value ?? 'all')}
                >
                  <SelectTrigger
                    id="user-filter-credential"
                    className="min-h-[44px] sm:min-h-[44px]"
                  >
                    <SelectValue>
                      {credentialFilter === 'all' ? 'すべて' : credentialFilter}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all" className="min-h-[44px]">
                      すべて
                    </SelectItem>
                    {credentialOptions.map((option) => (
                      <SelectItem key={option} value={option} className="min-h-[44px]">
                        {option}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>
          </details>
        </CardContent>
      </Card>

      <Sheet open={showInvite} onOpenChange={setShowInvite}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>ユーザーを招待</SheetTitle>
            <SheetDescription>Cognito 経由で招待メールが送信されます。</SheetDescription>
          </SheetHeader>
          <div className="mt-6 space-y-4">
            <Field label="氏名" htmlFor="invite-user-name">
              <Input
                id="invite-user-name"
                value={inviteForm.name}
                onChange={(event) =>
                  setInviteForm((current) => ({ ...current, name: event.target.value }))
                }
              />
            </Field>
            <Field label="フリガナ" htmlFor="invite-user-name-kana">
              <Input
                id="invite-user-name-kana"
                value={inviteForm.name_kana}
                onChange={(event) =>
                  setInviteForm((current) => ({
                    ...current,
                    name_kana: event.target.value,
                  }))
                }
              />
            </Field>
            <Field label="メールアドレス" htmlFor="invite-user-email">
              <Input
                id="invite-user-email"
                type="email"
                value={inviteForm.email}
                onChange={(event) =>
                  setInviteForm((current) => ({ ...current, email: event.target.value }))
                }
              />
            </Field>
            <Field label="電話番号" htmlFor="invite-user-phone">
              <Input
                id="invite-user-phone"
                value={inviteForm.phone}
                onChange={(event) =>
                  setInviteForm((current) => ({ ...current, phone: event.target.value }))
                }
              />
            </Field>
            <Field label="ロール" htmlFor="invite-user-role">
              <Select
                value={inviteForm.role}
                onValueChange={(value) =>
                  setInviteForm((current) => ({
                    ...current,
                    role: (value as ManageableMemberRole) ?? 'pharmacist',
                    site_id: value === 'external_viewer' ? '' : current.site_id,
                  }))
                }
              >
                <SelectTrigger id="invite-user-role">
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
            <Field label="所属店舗" htmlFor="invite-user-site">
              <Select
                value={inviteForm.site_id || 'unassigned'}
                onValueChange={(value) =>
                  setInviteForm((current) => ({
                    ...current,
                    site_id: value && value !== 'unassigned' ? value : '',
                  }))
                }
              >
                <SelectTrigger id="invite-user-site">
                  <SelectValue placeholder="選択してください" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unassigned">未設定</SelectItem>
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
                disabled={
                  inviteMutation.isPending ||
                  !inviteForm.name ||
                  !inviteForm.name_kana ||
                  !inviteForm.email ||
                  (roleRequiresSite(inviteForm.role) && !inviteForm.site_id)
                }
              >
                {inviteMutation.isPending ? '招待中...' : '招待する'}
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      <Sheet
        open={!!detailUser}
        onOpenChange={(open) => {
          if (!open) {
            setDetailUser(null);
            setDetailForm(null);
          }
        }}
      >
        <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
          <SheetHeader>
            <SheetTitle>ユーザー詳細</SheetTitle>
            <SheetDescription>
              権限フラグ、訪問制約、Cognito 同期状態を編集できます。
            </SheetDescription>
          </SheetHeader>
          {detailUser && detailForm ? (
            <div className="mt-6 space-y-5">
              <div className="flex flex-wrap items-center gap-2">
                {statusBadge(detailUser.account_status)}
                <Badge variant={detailUser.cognito_linked ? 'default' : 'secondary'}>
                  {detailUser.cognito_linked ? 'Cognito同期済み' : 'Cognito未接続'}
                </Badge>
                <Badge variant="outline">今月訪問 {detailUser.monthly_visit_count}件</Badge>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <Field label="氏名" htmlFor="detail-user-name">
                  <Input
                    id="detail-user-name"
                    value={detailForm.name}
                    onChange={(event) =>
                      setDetailForm((current) =>
                        current ? { ...current, name: event.target.value } : current,
                      )
                    }
                  />
                </Field>
                <Field label="フリガナ" htmlFor="detail-user-name-kana">
                  <Input
                    id="detail-user-name-kana"
                    value={detailForm.name_kana}
                    onChange={(event) =>
                      setDetailForm((current) =>
                        current ? { ...current, name_kana: event.target.value } : current,
                      )
                    }
                  />
                </Field>
                <Field label="メールアドレス" htmlFor="detail-user-email">
                  <Input id="detail-user-email" value={detailUser.email} readOnly disabled />
                </Field>
                <Field label="電話番号" htmlFor="detail-user-phone">
                  <Input
                    id="detail-user-phone"
                    value={detailForm.phone}
                    onChange={(event) =>
                      setDetailForm((current) =>
                        current ? { ...current, phone: event.target.value } : current,
                      )
                    }
                  />
                </Field>
                <Field label="ロール" htmlFor="detail-user-role">
                  <Select
                    value={detailForm.role}
                    onValueChange={(value) =>
                      setDetailForm((current) =>
                        current
                          ? {
                              ...current,
                              role: (value as ManageableMemberRole) ?? current.role,
                              site_id: value === 'external_viewer' ? '' : current.site_id,
                            }
                          : current,
                      )
                    }
                  >
                    <SelectTrigger id="detail-user-role">
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
                <Field label="所属店舗" htmlFor="detail-user-site">
                  <Select
                    value={detailForm.site_id || 'unassigned'}
                    onValueChange={(value) =>
                      setDetailForm((current) =>
                        current
                          ? {
                              ...current,
                              site_id: value && value !== 'unassigned' ? value : '',
                            }
                          : current,
                      )
                    }
                  >
                    <SelectTrigger id="detail-user-site">
                      <SelectValue placeholder="選択してください" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="unassigned">未設定</SelectItem>
                      {sites.map((site) => (
                        <SelectItem key={site.id} value={site.id}>
                          {site.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              </div>

              <div className="space-y-3 rounded-lg border p-4">
                <div>
                  <div className="font-medium">工程権限</div>
                  <p className="text-xs text-muted-foreground">
                    ロール初期値から個別に上書きできます。
                  </p>
                </div>
                <ToggleRow
                  id="detail-can-dispense"
                  label="調剤入力"
                  checked={detailForm.can_dispense}
                  onCheckedChange={(checked) =>
                    setDetailForm((current) =>
                      current ? { ...current, can_dispense: checked } : current,
                    )
                  }
                />
                <ToggleRow
                  id="detail-can-audit-dispense"
                  label="調剤監査"
                  checked={detailForm.can_audit_dispense}
                  onCheckedChange={(checked) =>
                    setDetailForm((current) =>
                      current ? { ...current, can_audit_dispense: checked } : current,
                    )
                  }
                />
                <ToggleRow
                  id="detail-can-set"
                  label="セット作業"
                  checked={detailForm.can_set}
                  onCheckedChange={(checked) =>
                    setDetailForm((current) =>
                      current ? { ...current, can_set: checked } : current,
                    )
                  }
                />
                <ToggleRow
                  id="detail-can-audit-set"
                  label="セット監査"
                  checked={detailForm.can_audit_set}
                  onCheckedChange={(checked) =>
                    setDetailForm((current) =>
                      current ? { ...current, can_audit_set: checked } : current,
                    )
                  }
                />
              </div>

              <div className="space-y-3 rounded-lg border p-4">
                <div>
                  <div className="font-medium">訪問制約</div>
                  <p
                    id={VISIT_CONSTRAINT_DISABLED_HELP_ID}
                    className="text-xs text-muted-foreground"
                  >
                    非訪問ロールでは保存時にクリアされます。
                  </p>
                </div>
                <div className="grid gap-4 md:grid-cols-3">
                  <Field label="日次上限" htmlFor="detail-max-daily-visits">
                    <Input
                      id="detail-max-daily-visits"
                      type="number"
                      min={VISIT_LIMITS.max_daily_visits.min}
                      max={VISIT_LIMITS.max_daily_visits.max}
                      step={1}
                      inputMode="numeric"
                      value={detailForm.max_daily_visits}
                      onChange={(event) =>
                        setDetailForm((current) =>
                          current ? { ...current, max_daily_visits: event.target.value } : current,
                        )
                      }
                      disabled={!operationalRole}
                      aria-invalid={Boolean(visitLimitErrors.max_daily_visits)}
                      aria-describedby={descriptionIds(
                        'detail-max-daily-visits-help',
                        !operationalRole && VISIT_CONSTRAINT_DISABLED_HELP_ID,
                        visitLimitErrors.max_daily_visits && 'detail-max-daily-visits-error',
                      )}
                    />
                    <p id="detail-max-daily-visits-help" className="text-xs text-muted-foreground">
                      1〜20件の整数。空欄は未設定。
                    </p>
                    {visitLimitErrors.max_daily_visits ? (
                      <p
                        id="detail-max-daily-visits-error"
                        className="text-xs text-destructive"
                        role="alert"
                      >
                        {visitLimitErrors.max_daily_visits}
                      </p>
                    ) : null}
                  </Field>
                  <Field label="週次上限" htmlFor="detail-max-weekly-visits">
                    <Input
                      id="detail-max-weekly-visits"
                      type="number"
                      min={VISIT_LIMITS.max_weekly_visits.min}
                      max={VISIT_LIMITS.max_weekly_visits.max}
                      step={1}
                      inputMode="numeric"
                      value={detailForm.max_weekly_visits}
                      onChange={(event) =>
                        setDetailForm((current) =>
                          current ? { ...current, max_weekly_visits: event.target.value } : current,
                        )
                      }
                      disabled={!operationalRole}
                      aria-invalid={Boolean(visitLimitErrors.max_weekly_visits)}
                      aria-describedby={descriptionIds(
                        'detail-max-weekly-visits-help',
                        !operationalRole && VISIT_CONSTRAINT_DISABLED_HELP_ID,
                        visitLimitErrors.max_weekly_visits && 'detail-max-weekly-visits-error',
                      )}
                    />
                    <p id="detail-max-weekly-visits-help" className="text-xs text-muted-foreground">
                      1〜100件の整数。空欄は未設定。
                    </p>
                    {visitLimitErrors.max_weekly_visits ? (
                      <p
                        id="detail-max-weekly-visits-error"
                        className="text-xs text-destructive"
                        role="alert"
                      >
                        {visitLimitErrors.max_weekly_visits}
                      </p>
                    ) : null}
                  </Field>
                  <Field label="移動上限(分)" htmlFor="detail-max-travel-minutes">
                    <Input
                      id="detail-max-travel-minutes"
                      type="number"
                      min={VISIT_LIMITS.max_travel_minutes.min}
                      max={VISIT_LIMITS.max_travel_minutes.max}
                      step={1}
                      inputMode="numeric"
                      value={detailForm.max_travel_minutes}
                      onChange={(event) =>
                        setDetailForm((current) =>
                          current
                            ? { ...current, max_travel_minutes: event.target.value }
                            : current,
                        )
                      }
                      disabled={!operationalRole}
                      aria-invalid={Boolean(visitLimitErrors.max_travel_minutes)}
                      aria-describedby={descriptionIds(
                        'detail-max-travel-minutes-help',
                        !operationalRole && VISIT_CONSTRAINT_DISABLED_HELP_ID,
                        visitLimitErrors.max_travel_minutes && 'detail-max-travel-minutes-error',
                      )}
                    />
                    <p
                      id="detail-max-travel-minutes-help"
                      className="text-xs text-muted-foreground"
                    >
                      0〜480分の整数。空欄は未設定。
                    </p>
                    {visitLimitErrors.max_travel_minutes ? (
                      <p
                        id="detail-max-travel-minutes-error"
                        className="text-xs text-destructive"
                        role="alert"
                      >
                        {visitLimitErrors.max_travel_minutes}
                      </p>
                    ) : null}
                  </Field>
                </div>
                <ToggleRow
                  id="detail-can-accept-emergency"
                  label="緊急対応可"
                  checked={detailForm.can_accept_emergency}
                  onCheckedChange={(checked) =>
                    setDetailForm((current) =>
                      current ? { ...current, can_accept_emergency: checked } : current,
                    )
                  }
                  disabled={!operationalRole}
                  describedBy={!operationalRole ? VISIT_CONSTRAINT_DISABLED_HELP_ID : undefined}
                />
                <Field label="専門分野" htmlFor="detail-visit-specialties">
                  <Textarea
                    id="detail-visit-specialties"
                    value={detailForm.visit_specialties}
                    onChange={(event) =>
                      setDetailForm((current) =>
                        current ? { ...current, visit_specialties: event.target.value } : current,
                      )
                    }
                    placeholder="在宅中心静脈栄養, 緩和ケア など"
                    disabled={!operationalRole}
                    aria-describedby={
                      !operationalRole ? VISIT_CONSTRAINT_DISABLED_HELP_ID : undefined
                    }
                  />
                </Field>
                <Field label="対応エリア" htmlFor="detail-coverage-area">
                  <Textarea
                    id="detail-coverage-area"
                    value={detailForm.coverage_area}
                    onChange={(event) =>
                      setDetailForm((current) =>
                        current ? { ...current, coverage_area: event.target.value } : current,
                      )
                    }
                    placeholder="港区, 品川区 など"
                    disabled={!operationalRole}
                    aria-describedby={
                      !operationalRole ? VISIT_CONSTRAINT_DISABLED_HELP_ID : undefined
                    }
                  />
                </Field>
              </div>

              <div className="space-y-2 text-sm text-muted-foreground">
                <MetaRow
                  label="招待日"
                  value={
                    detailUser.invited_at
                      ? new Date(detailUser.invited_at).toLocaleDateString('ja-JP')
                      : '未設定'
                  }
                />
                <MetaRow
                  label="最終招待日"
                  value={
                    detailUser.last_invited_at
                      ? new Date(detailUser.last_invited_at).toLocaleDateString('ja-JP')
                      : '未設定'
                  }
                />
                <MetaRow
                  label="有効化日"
                  value={
                    detailUser.activated_at
                      ? new Date(detailUser.activated_at).toLocaleDateString('ja-JP')
                      : '未設定'
                  }
                />
                {detailUser.deactivated_at ? (
                  <MetaRow
                    label="停止日"
                    value={new Date(detailUser.deactivated_at).toLocaleDateString('ja-JP')}
                  />
                ) : null}
                {detailUser.deactivation_reason ? (
                  <MetaRow label="停止理由" value={detailUser.deactivation_reason} />
                ) : null}
              </div>

              <div className="flex justify-end gap-2 pb-2">
                {detailUser.account_status !== 'retired' ? (
                  <Button
                    variant="outline"
                    aria-label={`${detailUser.name}を退職処理`}
                    onClick={() =>
                      setActionDialog({
                        type: 'retire',
                        user: detailUser,
                        reason: '',
                      })
                    }
                  >
                    退職処理
                  </Button>
                ) : null}
                <Button
                  variant="outline"
                  onClick={() => {
                    setDetailUser(null);
                    setDetailForm(null);
                  }}
                >
                  閉じる
                </Button>
                {detailSaveBlocker ? (
                  <p id={DETAIL_SAVE_BLOCKER_ID} className="self-center text-xs text-destructive">
                    {detailSaveBlocker}
                  </p>
                ) : null}
                <Button
                  onClick={() => detailMutation.mutate()}
                  disabled={detailMutation.isPending || Boolean(detailSaveBlocker)}
                  aria-describedby={detailSaveBlocker ? DETAIL_SAVE_BLOCKER_ID : undefined}
                >
                  {detailMutation.isPending ? '保存中...' : '変更を保存'}
                </Button>
              </div>
            </div>
          ) : null}
        </SheetContent>
      </Sheet>

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
          {actionDialog?.type === 'suspend' || actionDialog?.type === 'retire' ? (
            <div className="py-2">
              <Label htmlFor="user-action-reason" className="mb-1.5 block">
                理由
              </Label>
              <Textarea
                id="user-action-reason"
                value={actionDialog.reason}
                onChange={(event) =>
                  setActionDialog((current) =>
                    current ? { ...current, reason: event.target.value } : null,
                  )
                }
                placeholder="停止・退職理由を入力してください"
              />
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setActionDialog(null)}>
              キャンセル
            </Button>
            <Button
              variant={
                actionDialog?.type === 'suspend' || actionDialog?.type === 'retire'
                  ? 'destructive'
                  : 'default'
              }
              onClick={() => actionMutation.mutate()}
              disabled={
                actionMutation.isPending ||
                ((actionDialog?.type === 'suspend' || actionDialog?.type === 'retire') &&
                  !actionDialog?.reason.trim())
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

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  );
}

function ToggleRow({
  id,
  label,
  checked,
  onCheckedChange,
  disabled,
  describedBy,
}: {
  id: string;
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  describedBy?: string;
}) {
  return (
    <div className="flex items-center justify-between rounded-md border px-3 py-2">
      <Label htmlFor={id} className="text-sm">
        {label}
      </Label>
      <Switch
        id={id}
        checked={checked}
        onCheckedChange={(value) => onCheckedChange(value === true)}
        disabled={disabled}
        aria-describedby={describedBy}
      />
    </div>
  );
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}
