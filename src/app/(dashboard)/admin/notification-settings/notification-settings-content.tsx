'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Bell, BellRing, Loader2, MessageSquareText, ShieldAlert, Smartphone } from 'lucide-react';
import { toast } from 'sonner';
import { AdminPageHeader } from '@/components/features/admin/admin-page-header';
import { getAdminNotificationSettingsShortcutLinks } from '@/components/features/admin/admin-page-shortcut-presets';
import { useOrgId } from '@/lib/hooks/use-org-id';
import {
  getBrowserNotificationPreference,
  isBrowserNotificationSupported,
  setBrowserNotificationPreference,
} from '@/lib/browser-notifications';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { StateBadge } from '@/components/ui/state-badge';
import type { StatusRole } from '@/lib/constants/status-tokens';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  Dialog,
  DialogContent,
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
  escalationActionTypes,
  escalationNotifyRoles,
  escalationTriggerTypes,
} from '@/lib/validations/escalation-rule';
import { PageScaffold } from '@/components/layout/page-scaffold';
import { parseEscalationThresholdHoursInput } from './escalation-threshold';

type NotificationRule = {
  id: string;
  event_type: string;
  channel: 'in_app' | 'email' | 'sms' | 'line' | 'fax' | 'mcs';
  enabled: boolean;
  recipients: {
    roles?: string[];
    user_ids?: string[];
  } | null;
  created_at: string;
};

type EscalationRule = {
  id: string;
  trigger_type: (typeof escalationTriggerTypes)[number];
  condition: {
    threshold_hours: number;
    severity?: 'normal' | 'high' | 'urgent';
    status_in?: string[];
  } | null;
  action: (typeof escalationActionTypes)[number];
  notify_role: (typeof escalationNotifyRoles)[number] | null;
  is_active: boolean;
  created_at: string;
};

type EventConfig = {
  eventType: string;
  title: string;
  description: string;
  badge: 'urgent' | 'business' | 'reminder';
};

const EVENT_CONFIGS: EventConfig[] = [
  {
    eventType: 'patient_self_report_followup_due',
    title: '患者・家族の自己申告フォロー',
    description: '自己申告や折り返し依頼への対応を通知します。',
    badge: 'urgent',
  },
  {
    eventType: 'visit_schedule_reschedule_requested',
    title: '訪問リスケ承認依頼',
    description: '確定済み訪問の変更承認待ちを通知します。',
    badge: 'business',
  },
  {
    eventType: 'visit_schedule_reschedule_approved',
    title: '訪問リスケ承認結果',
    description: '変更承認後の確定待ち状態を通知します。',
    badge: 'business',
  },
  {
    eventType: 'visit_intake_linkage_due',
    title: '処方受付から訪問候補への接続漏れ',
    description: '訪問候補や架電導線の未作成を通知します。',
    badge: 'business',
  },
  {
    eventType: 'visit_demand_created',
    title: '訪問候補の自動提案',
    description: '服薬期限に応じた新規訪問候補の生成を通知します。',
    badge: 'business',
  },
  {
    eventType: 'medication_deadline_approaching',
    title: '服用最終日接近',
    description: '服薬終了が近い患者の訪問準備を通知します。',
    badge: 'reminder',
  },
  {
    eventType: 'refill_due_soon',
    title: 'リフィル調剤期日接近',
    description: '次回調剤日が近いリフィル処方を通知します。',
    badge: 'reminder',
  },
  {
    eventType: 'management_plan_review_due',
    title: '管理計画書レビュー期限',
    description: '計画書の見直し期限到来を通知します。',
    badge: 'reminder',
  },
];

// 通知イベント分類: 緊急=blocked(赤) / 業務=info(青, 情報タグ) / リマインド=confirm(橙, 要対応)
const BADGE_VARIANTS: Record<EventConfig['badge'], { label: string; role: StatusRole }> = {
  urgent: {
    label: '緊急',
    role: 'blocked',
  },
  business: {
    label: '業務',
    role: 'info',
  },
  reminder: {
    label: 'リマインド',
    role: 'confirm',
  },
};

const NOTIFICATION_CHANNEL_OPTIONS = [
  {
    value: 'in_app',
    label: 'アプリ内',
    description: '通知センターとベルに表示',
    icon: Bell,
  },
  {
    value: 'sms',
    label: 'SMS',
    description: '電話番号登録ユーザーへ送信',
    icon: Smartphone,
  },
  {
    value: 'line',
    label: 'LINE',
    description: 'LINE アダプタ経由で送信',
    icon: MessageSquareText,
  },
  {
    value: 'fax',
    label: 'FAX',
    description: 'FAX 送付タスクの通知先として扱う',
    icon: MessageSquareText,
  },
  {
    value: 'mcs',
    label: 'MCS',
    description: 'MCS 連携先への通知先として扱う',
    icon: MessageSquareText,
  },
] as const;

type SupportedNotificationChannel = (typeof NOTIFICATION_CHANNEL_OPTIONS)[number]['value'];
const NOTIFICATION_CHANNEL_LABELS = Object.fromEntries(
  NOTIFICATION_CHANNEL_OPTIONS.map((channel) => [channel.value, channel.label]),
) as Record<SupportedNotificationChannel, string>;

const ESCALATION_THRESHOLD_ERROR_MESSAGE = 'しきい時間は 1〜720 の整数で入力してください';
const ESCALATION_THRESHOLD_HELP_ID = 'escalation-threshold-help';
const ESCALATION_THRESHOLD_ERROR_ID = 'escalation-threshold-error';

const ESCALATION_TRIGGER_OPTIONS: Array<{
  value: EscalationRule['trigger_type'];
  label: string;
  description: string;
}> = [
  {
    value: 'communication_response_overdue',
    label: '連携返信期限超過',
    description: '医師・多職種への返信待ちが SLA を超えた場合に反応します。',
  },
  {
    value: 'workflow_exception_unresolved',
    label: 'WorkflowException 未解消',
    description: '差戻しや止まっている業務が残り続けた場合に反応します。',
  },
  {
    value: 'report_delivery_failed',
    label: '報告書送付失敗',
    description: '送付失敗や再送待ちが一定時間を超えた場合に反応します。',
  },
  {
    value: 'billing_review_stalled',
    label: '請求レビュー停滞',
    description: '請求候補のレビュー待ちが積み上がった場合に反応します。',
  },
  {
    value: 'visit_reschedule_unapproved',
    label: '訪問変更承認待ち',
    description: 'リスケ提案の承認待ちが長引いた場合に反応します。',
  },
];

const ESCALATION_ACTION_OPTIONS: Array<{
  value: EscalationRule['action'];
  label: string;
}> = [
  { value: 'in_app_notification', label: 'アプリ内通知' },
  { value: 'email_digest', label: 'メール通知' },
  { value: 'conference_task', label: 'タスク起票' },
  { value: 'admin_alert', label: '管理者アラート' },
];

const ESCALATION_ROLE_OPTIONS: Array<{
  value: NonNullable<EscalationRule['notify_role']>;
  label: string;
}> = [
  { value: 'admin', label: '管理者' },
  { value: 'manager', label: 'マネージャー' },
  { value: 'pharmacist', label: '薬剤師' },
  { value: 'office_staff', label: '事務' },
];

function escalationRuleSummary(rule: EscalationRule) {
  const trigger =
    ESCALATION_TRIGGER_OPTIONS.find((item) => item.value === rule.trigger_type)?.label ??
    rule.trigger_type;
  const action =
    ESCALATION_ACTION_OPTIONS.find((item) => item.value === rule.action)?.label ?? rule.action;
  const role = rule.notify_role
    ? (ESCALATION_ROLE_OPTIONS.find((item) => item.value === rule.notify_role)?.label ??
      rule.notify_role)
    : '通知先未指定';
  const thresholdHours = rule.condition?.threshold_hours ?? '未設定';

  return `${trigger} / ${action} / ${role} / ${thresholdHours}時間`;
}

function isPermissionSupported() {
  return isBrowserNotificationSupported();
}

function readBrowserNotificationState(): {
  permission: NotificationPermission | 'unsupported';
  enabled: boolean;
} {
  if (!isPermissionSupported()) {
    return { permission: 'unsupported', enabled: false };
  }
  return {
    permission: Notification.permission,
    enabled: getBrowserNotificationPreference(),
  };
}

export function NotificationSettingsContent() {
  const orgId = useOrgId();
  const [rules, setRules] = useState<NotificationRule[]>([]);
  const [escalationRules, setEscalationRules] = useState<EscalationRule[]>([]);
  const [rulesLoadedOrgId, setRulesLoadedOrgId] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [browserNotificationState, setBrowserNotificationState] = useState(
    readBrowserNotificationState,
  );
  const [newEscalationOpen, setNewEscalationOpen] = useState(false);
  const [newEscalationTrigger, setNewEscalationTrigger] = useState<EscalationRule['trigger_type']>(
    'communication_response_overdue',
  );
  const [newEscalationAction, setNewEscalationAction] =
    useState<EscalationRule['action']>('in_app_notification');
  const [newEscalationRole, setNewEscalationRole] =
    useState<NonNullable<EscalationRule['notify_role']>>('admin');
  const [newEscalationThresholdHours, setNewEscalationThresholdHours] = useState('24');
  const [newEscalationThresholdError, setNewEscalationThresholdError] = useState<string | null>(
    null,
  );
  const [deleteEscalationTarget, setDeleteEscalationTarget] = useState<EscalationRule | null>(null);

  useEffect(() => {
    if (!orgId) return;

    let active = true;
    void fetch('/api/notification-rules', {
      headers: { 'x-org-id': orgId },
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error('通知設定の取得に失敗しました');
        }
        return (await response.json()) as { data?: NotificationRule[] };
      })
      .then((payload) => {
        if (!active) return;
        setRules(payload.data ?? []);
        setRulesLoadedOrgId(orgId);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setRulesLoadedOrgId(orgId);
        toast.error(error instanceof Error ? error.message : '通知設定の取得に失敗しました');
      });

    return () => {
      active = false;
    };
  }, [orgId]);

  useEffect(() => {
    if (!orgId) return;

    let active = true;
    void fetch('/api/admin/escalation-rules', {
      headers: { 'x-org-id': orgId },
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error('エスカレーションルールの取得に失敗しました');
        }
        return (await response.json()) as { data?: EscalationRule[] };
      })
      .then((payload) => {
        if (!active) return;
        setEscalationRules(payload.data ?? []);
      })
      .catch((error: unknown) => {
        if (!active) return;
        toast.error(
          error instanceof Error ? error.message : 'エスカレーションルールの取得に失敗しました',
        );
      });

    return () => {
      active = false;
    };
  }, [orgId]);

  const loading = Boolean(orgId) && rulesLoadedOrgId !== orgId;
  const permission = browserNotificationState.permission;
  const browserNotificationsEnabled = browserNotificationState.enabled;

  const rulesByEvent = useMemo(() => {
    return EVENT_CONFIGS.reduce<
      Record<string, Partial<Record<SupportedNotificationChannel, NotificationRule | null>>>
    >((acc, config) => {
      const channels = NOTIFICATION_CHANNEL_OPTIONS.reduce<
        Partial<Record<SupportedNotificationChannel, NotificationRule | null>>
      >((channelAcc, channel) => {
        channelAcc[channel.value] =
          rules
            .filter(
              (candidate) =>
                candidate.event_type === config.eventType && candidate.channel === channel.value,
            )
            .sort((left, right) => right.created_at.localeCompare(left.created_at))[0] ?? null;
        return channelAcc;
      }, {});
      acc[config.eventType] = channels;
      return acc;
    }, {});
  }, [rules]);

  const toggleEvent = useCallback(
    async (eventType: string, channel: SupportedNotificationChannel, enabled: boolean) => {
      if (!orgId) return;
      const existing = rulesByEvent[eventType]?.[channel] ?? null;
      const savingId = `event:${eventType}:${channel}`;
      setSavingKey(savingId);
      try {
        const response = await fetch(
          existing ? `/api/notification-rules/${existing.id}` : '/api/notification-rules',
          {
            method: existing ? 'PATCH' : 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-org-id': orgId,
            },
            body: JSON.stringify(
              existing
                ? { enabled }
                : {
                    event_type: eventType,
                    channel,
                    recipients: {},
                    enabled,
                  },
            ),
          },
        );
        if (!response.ok) {
          throw new Error('通知設定の保存に失敗しました');
        }
        const payload = (await response.json()) as { data?: NotificationRule } | NotificationRule;
        const nextRule =
          'data' in payload && payload.data ? payload.data : (payload as NotificationRule);
        setRules((prev) => {
          if (!existing) {
            return [nextRule, ...prev];
          }
          return prev.map((rule) => (rule.id === existing.id ? nextRule : rule));
        });
        const channelLabel = NOTIFICATION_CHANNEL_LABELS[channel];
        toast.success(
          enabled ? `${channelLabel}通知を有効化しました` : `${channelLabel}通知を停止しました`,
        );
      } catch (error) {
        toast.error(error instanceof Error ? error.message : '通知設定の保存に失敗しました');
      } finally {
        setSavingKey(null);
      }
    },
    [orgId, rulesByEvent],
  );

  const enableBrowserNotifications = useCallback(async () => {
    if (!isPermissionSupported()) {
      toast.error('このブラウザでは通知権限を利用できません');
      return;
    }
    if (Notification.permission === 'denied') {
      toast.error('ブラウザ設定で通知を許可してください');
      setBrowserNotificationState({ permission: 'denied', enabled: false });
      return;
    }

    const nextPermission =
      Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();

    if (nextPermission !== 'granted') {
      setBrowserNotificationPreference(false);
      setBrowserNotificationState({ permission: nextPermission, enabled: false });
      toast.error('通知権限が許可されませんでした');
      return;
    }

    setBrowserNotificationPreference(true);
    setBrowserNotificationState({ permission: nextPermission, enabled: true });
    toast.success('ブラウザ通知を有効にしました');
  }, []);

  const disableBrowserNotifications = useCallback(() => {
    setBrowserNotificationPreference(false);
    setBrowserNotificationState((current) => ({ ...current, enabled: false }));
    toast.success('ブラウザ通知を停止しました');
  }, []);

  const toggleEscalationRule = useCallback(
    async (rule: EscalationRule, isActive: boolean) => {
      if (!orgId) return;
      setSavingKey(`escalation:${rule.id}`);
      try {
        const response = await fetch(`/api/admin/escalation-rules/${rule.id}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'x-org-id': orgId,
          },
          body: JSON.stringify({ is_active: isActive }),
        });
        if (!response.ok) {
          throw new Error('エスカレーションルールの保存に失敗しました');
        }
        const payload = (await response.json()) as { data?: EscalationRule };
        if (payload.data) {
          setEscalationRules((prev) =>
            prev.map((item) => (item.id === rule.id ? payload.data! : item)),
          );
        }
        toast.success(
          isActive ? 'エスカレーションを有効化しました' : 'エスカレーションを停止しました',
        );
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : 'エスカレーションルールの保存に失敗しました',
        );
      } finally {
        setSavingKey(null);
      }
    },
    [orgId],
  );

  const createEscalationRule = useCallback(async () => {
    if (!orgId) return;
    const thresholdHours = parseEscalationThresholdHoursInput(newEscalationThresholdHours);
    if (thresholdHours === null) {
      setNewEscalationThresholdError(ESCALATION_THRESHOLD_ERROR_MESSAGE);
      return;
    }
    setNewEscalationThresholdError(null);

    setSavingKey('escalation:new');
    try {
      const response = await fetch('/api/admin/escalation-rules', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-org-id': orgId,
        },
        body: JSON.stringify({
          trigger_type: newEscalationTrigger,
          action: newEscalationAction,
          notify_role: newEscalationRole,
          is_active: true,
          condition: {
            threshold_hours: thresholdHours,
            severity: 'high',
          },
        }),
      });
      if (!response.ok) {
        throw new Error('エスカレーションルールの作成に失敗しました');
      }
      const payload = (await response.json()) as { data?: EscalationRule };
      if (payload.data) {
        setEscalationRules((prev) => [payload.data!, ...prev]);
      }
      setNewEscalationOpen(false);
      setNewEscalationThresholdHours('24');
      setNewEscalationThresholdError(null);
      toast.success('エスカレーションルールを追加しました');
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'エスカレーションルールの作成に失敗しました',
      );
    } finally {
      setSavingKey(null);
    }
  }, [
    newEscalationAction,
    newEscalationRole,
    newEscalationThresholdHours,
    newEscalationTrigger,
    orgId,
  ]);

  const handleNewEscalationOpenChange = useCallback((open: boolean) => {
    setNewEscalationOpen(open);
    if (!open) {
      setNewEscalationThresholdError(null);
    }
  }, []);

  const deleteEscalationRule = useCallback(
    async (ruleId: string) => {
      if (!orgId) return;
      setSavingKey(`escalation:delete:${ruleId}`);
      try {
        const response = await fetch(`/api/admin/escalation-rules/${ruleId}`, {
          method: 'DELETE',
          headers: { 'x-org-id': orgId },
        });
        if (!response.ok) {
          throw new Error('エスカレーションルールの削除に失敗しました');
        }
        setEscalationRules((prev) => prev.filter((rule) => rule.id !== ruleId));
        setDeleteEscalationTarget((current) => (current?.id === ruleId ? null : current));
        toast.success('エスカレーションルールを削除しました');
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : 'エスカレーションルールの削除に失敗しました',
        );
      } finally {
        setSavingKey(null);
      }
    },
    [orgId],
  );

  return (
    <PageScaffold>
      <AdminPageHeader
        title="通知設定"
        description="イベントごとのアプリ内通知、ブラウザ通知、エスカレーション条件を管理します。"
        shortcuts={getAdminNotificationSettingsShortcutLinks()}
      />

      <Alert>
        <ShieldAlert className="size-4" aria-hidden="true" />
        <AlertTitle>現在の適用範囲</AlertTitle>
        <AlertDescription>
          ここでの ON/OFF は `in_app / sms / line` の各チャネルに適用されます。ブラウザ通知は
          `in_app` 通知をバックグラウンド受信したときに表示されます。
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BellRing className="size-4" aria-hidden="true" />
            ブラウザ通知
          </CardTitle>
          <CardDescription>PWA/ブラウザ権限を使ってデスクトップ通知を表示します。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">
              権限: {permission === 'unsupported' ? '非対応' : permission}
            </Badge>
            <Badge variant={browserNotificationsEnabled ? 'secondary' : 'outline'}>
              {browserNotificationsEnabled ? '有効' : '無効'}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            緊急連絡や差戻しなどの新着通知を、ブラウザがバックグラウンドでも確認しやすくします。
          </p>
        </CardContent>
        <CardFooter className="gap-2">
          <Button
            type="button"
            aria-label="ブラウザ通知を許可して有効化"
            onClick={() => void enableBrowserNotifications()}
            disabled={permission === 'unsupported'}
          >
            許可して有効化
          </Button>
          <Button
            type="button"
            variant="outline"
            aria-label="ブラウザ通知を停止"
            onClick={disableBrowserNotifications}
            disabled={!browserNotificationsEnabled}
          >
            停止
          </Button>
        </CardFooter>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bell className="size-4" aria-hidden="true" />
            イベント通知ルール
          </CardTitle>
          <CardDescription>
            `in_app` は未設定でも既定で配信されます。`sms` と `line` は明示的に ON
            にしたイベントだけ配信されます。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              通知設定を読み込み中です
            </div>
          ) : (
            EVENT_CONFIGS.map((config) => {
              const badge = BADGE_VARIANTS[config.badge];

              return (
                <div
                  key={config.eventType}
                  className="flex flex-col gap-3 rounded-xl border border-border px-4 py-3 md:flex-row md:items-start md:justify-between"
                >
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium text-foreground">{config.title}</p>
                      <StateBadge role={badge.role}>{badge.label}</StateBadge>
                    </div>
                    <p className="text-sm text-muted-foreground">{config.description}</p>
                    <p className="font-mono text-xs text-muted-foreground/70">{config.eventType}</p>
                  </div>
                  <div className="grid gap-2 sm:min-w-80">
                    {NOTIFICATION_CHANNEL_OPTIONS.map((channel) => {
                      const rule = rulesByEvent[config.eventType]?.[channel.value] ?? null;
                      const enabled =
                        channel.value === 'in_app'
                          ? (rule?.enabled ?? true)
                          : (rule?.enabled ?? false);
                      const isSaving = savingKey === `event:${config.eventType}:${channel.value}`;
                      const Icon = channel.icon;

                      return (
                        <label
                          key={channel.value}
                          className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 text-sm"
                        >
                          <span className="flex min-w-0 items-center gap-3">
                            <span className="rounded-full border border-border bg-background p-1.5">
                              <Icon className="size-3.5 text-muted-foreground" aria-hidden="true" />
                            </span>
                            <span>
                              <span className="block font-medium text-foreground">
                                {channel.label}
                              </span>
                              <span className="block text-xs text-muted-foreground">
                                {channel.description}
                              </span>
                            </span>
                          </span>
                          <span className="flex items-center gap-3">
                            {!rule && channel.value === 'in_app' ? (
                              <Badge variant="outline">既定ON</Badge>
                            ) : null}
                            <Checkbox
                              checked={enabled}
                              disabled={isSaving}
                              onCheckedChange={(checked) =>
                                void toggleEvent(config.eventType, channel.value, checked === true)
                              }
                            />
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              );
            })
          )}
        </CardContent>
        <CardFooter className="justify-between gap-3 text-xs text-muted-foreground">
          <span>通知配信そのものはイベント発火時に処理されます。</span>
          <span>`sms` は電話番号、`line` は LINE アダプタ経由で配信します。</span>
        </CardFooter>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle>エスカレーションルール</CardTitle>
              <CardDescription>
                停滞や失敗が一定時間続いたときに、誰へ何を起こすかを定義します。
              </CardDescription>
            </div>
            <Button type="button" size="sm" onClick={() => handleNewEscalationOpenChange(true)}>
              ルール追加
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {escalationRules.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              エスカレーションルールはまだありません。
            </p>
          ) : (
            escalationRules.map((rule) => {
              const trigger =
                ESCALATION_TRIGGER_OPTIONS.find((item) => item.value === rule.trigger_type) ??
                ESCALATION_TRIGGER_OPTIONS[0];
              const action =
                ESCALATION_ACTION_OPTIONS.find((item) => item.value === rule.action) ??
                ESCALATION_ACTION_OPTIONS[0];
              const role = ESCALATION_ROLE_OPTIONS.find((item) => item.value === rule.notify_role);
              const isSaving = savingKey === `escalation:${rule.id}`;
              const isDeleting = savingKey === `escalation:delete:${rule.id}`;

              return (
                <div
                  key={rule.id}
                  className="flex flex-col gap-3 rounded-xl border border-border px-4 py-3 md:flex-row md:items-start md:justify-between"
                >
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium text-foreground">{trigger.label}</p>
                      <Badge variant={rule.is_active ? 'secondary' : 'outline'}>
                        {rule.is_active ? '有効' : '停止中'}
                      </Badge>
                      <Badge variant="outline">{action.label}</Badge>
                      {role ? <Badge variant="outline">{role.label}</Badge> : null}
                    </div>
                    <p className="text-sm text-muted-foreground">{trigger.description}</p>
                    <p className="text-xs text-muted-foreground">
                      しきい時間: {rule.condition?.threshold_hours ?? '—'} 時間
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="flex items-center gap-2 text-sm font-medium text-foreground">
                      <Checkbox
                        checked={rule.is_active}
                        disabled={isSaving || isDeleting}
                        onCheckedChange={(checked) =>
                          void toggleEscalationRule(rule, checked === true)
                        }
                      />
                      {isSaving ? '保存中...' : rule.is_active ? '有効' : '停止'}
                    </label>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={isDeleting}
                      aria-label={`${escalationRuleSummary(rule)} を削除`}
                      onClick={() => setDeleteEscalationTarget(rule)}
                    >
                      削除
                    </Button>
                  </div>
                </div>
              );
            })
          )}
        </CardContent>
      </Card>

      <Dialog open={newEscalationOpen} onOpenChange={handleNewEscalationOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>エスカレーションルールを追加</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="escalation-trigger">トリガー</Label>
              <Select
                value={newEscalationTrigger}
                onValueChange={(value) =>
                  setNewEscalationTrigger(value as EscalationRule['trigger_type'])
                }
              >
                <SelectTrigger id="escalation-trigger" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ESCALATION_TRIGGER_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="escalation-action">アクション</Label>
                <Select
                  value={newEscalationAction}
                  onValueChange={(value) =>
                    setNewEscalationAction(value as EscalationRule['action'])
                  }
                >
                  <SelectTrigger id="escalation-action" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ESCALATION_ACTION_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="escalation-role">通知先</Label>
                <Select
                  value={newEscalationRole}
                  onValueChange={(value) =>
                    setNewEscalationRole(value as NonNullable<EscalationRule['notify_role']>)
                  }
                >
                  <SelectTrigger id="escalation-role" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ESCALATION_ROLE_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="escalation-threshold">しきい時間</Label>
              <Input
                id="escalation-threshold"
                inputMode="numeric"
                value={newEscalationThresholdHours}
                aria-invalid={newEscalationThresholdError ? true : undefined}
                aria-describedby={
                  newEscalationThresholdError
                    ? `${ESCALATION_THRESHOLD_HELP_ID} ${ESCALATION_THRESHOLD_ERROR_ID}`
                    : ESCALATION_THRESHOLD_HELP_ID
                }
                onChange={(event) => {
                  setNewEscalationThresholdHours(event.target.value);
                  if (newEscalationThresholdError) {
                    setNewEscalationThresholdError(null);
                  }
                }}
              />
              <p id={ESCALATION_THRESHOLD_HELP_ID} className="text-xs text-muted-foreground">
                1〜720 時間の整数で入力してください。
              </p>
              {newEscalationThresholdError ? (
                <p
                  id={ESCALATION_THRESHOLD_ERROR_ID}
                  role="alert"
                  className="text-sm text-destructive"
                >
                  {newEscalationThresholdError}
                </p>
              ) : null}
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => handleNewEscalationOpenChange(false)}
            >
              キャンセル
            </Button>
            <Button
              type="button"
              disabled={savingKey === 'escalation:new'}
              onClick={() => void createEscalationRule()}
            >
              {savingKey === 'escalation:new' ? '保存中...' : '追加'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleteEscalationTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteEscalationTarget(null);
        }}
        title="エスカレーションルールを削除しますか"
        description={
          deleteEscalationTarget
            ? `${escalationRuleSummary(deleteEscalationTarget)} を削除します。この操作は取り消せません。停滞・失敗時の通知やタスク起票にも反映されます。`
            : ''
        }
        confirmLabel={
          deleteEscalationTarget && savingKey === `escalation:delete:${deleteEscalationTarget.id}`
            ? '削除中...'
            : '削除する'
        }
        confirmDisabled={
          deleteEscalationTarget
            ? savingKey === `escalation:delete:${deleteEscalationTarget.id}`
            : true
        }
        closeOnConfirm={false}
        variant="destructive"
        onConfirm={() => {
          if (deleteEscalationTarget) {
            void deleteEscalationRule(deleteEscalationTarget.id);
          }
        }}
      />
    </PageScaffold>
  );
}
