'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { signOut, useSession } from 'next-auth/react';
import { toast } from 'sonner';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Switch } from '@/components/ui/switch';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Check,
  KeyRound,
  ShieldCheck,
  User,
  Bell,
  AlertCircle,
  CalendarDays,
  ClipboardList,
  Clock,
  MapPin,
} from 'lucide-react';
import {
  ensureBrowserNotificationRegistration,
  getBrowserNotificationPreference,
  isBrowserNotificationSupported,
  setBrowserNotificationPreference,
} from '@/lib/browser-notifications';
import {
  getVisitLocationPermissionState,
  getVisitLocationTrackingPreference,
  setVisitLocationTrackingPreference,
  type VisitLocationPermissionState,
} from '@/lib/visit-location';
import {
  SESSION_TIMEOUT_MS,
  SESSION_WARNING_BEFORE_MS,
} from '@/lib/utils/session';

// --- Profile Tab ---

type ActivitySummary = {
  currentMonthVisitCount: number;
  last30DaysVisitCount: number;
  todayAssignedCount: number;
  upcomingAssignedCount: number;
};

function ProfileTab() {
  const [displayName, setDisplayName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [currentRole, setCurrentRole] = useState<string | null>(null);
  const [currentSiteName, setCurrentSiteName] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isBootstrapLoading, setIsBootstrapLoading] = useState(true);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activitySummary, setActivitySummary] = useState<ActivitySummary | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadProfile() {
      try {
        const response = await fetch('/api/me/profile');
        if (!response.ok) {
          const payload = (await response.json().catch(() => null)) as { message?: string } | null;
          throw new Error(payload?.message ?? 'プロフィールの取得に失敗しました。');
        }

        const payload = (await response.json()) as {
          data: {
            email: string;
            name: string;
            phone: string | null;
            currentRole: string | null;
            currentSiteName: string | null;
            mfaEnabled: boolean;
          };
        };

        if (cancelled) return;
        setEmail(payload.data.email);
        setDisplayName(payload.data.name);
        setPhone(payload.data.phone ?? '');
        setCurrentRole(payload.data.currentRole);
        setCurrentSiteName(payload.data.currentSiteName);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'プロフィールの取得に失敗しました。');
        }
      } finally {
        if (!cancelled) {
          setIsBootstrapLoading(false);
        }
      }
    }

    loadProfile();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadActivitySummary() {
      try {
        const response = await fetch('/api/me/activity-summary');
        if (!response.ok) {
          throw new Error('訪問実績サマリーの取得に失敗しました。');
        }
        const payload = (await response.json()) as { data: ActivitySummary };
        if (!cancelled) {
          setActivitySummary(payload.data);
        }
      } catch {
        if (!cancelled) {
          setActivitySummary(null);
        }
      }
    }

    void loadActivitySummary();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    try {
      const response = await fetch('/api/me/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: displayName,
          phone,
        }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { message?: string } | null;
        throw new Error(payload?.message ?? 'プロフィールの更新に失敗しました。');
      }

      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'プロフィールの更新に失敗しました。');
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <User className="h-5 w-5 text-blue-600" aria-hidden="true" />
          プロフィール
        </CardTitle>
        <CardDescription>表示名と連絡先情報を管理します</CardDescription>
      </CardHeader>
      <CardContent>
        {error && (
          <Alert variant="destructive" className="mb-4">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {saved && (
          <Alert className="mb-4 border-green-200 bg-green-50">
            <Check className="h-4 w-4 text-green-600" />
            <AlertDescription className="text-green-800">
              プロフィールを更新しました。
            </AlertDescription>
          </Alert>
        )}

        <form onSubmit={handleSave} className="flex flex-col gap-4 max-w-lg">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="profile-email">メールアドレス</Label>
            <Input
              id="profile-email"
              type="email"
              value={email}
              disabled
              className="bg-slate-50"
            />
            <p className="text-xs text-slate-500">
              メールアドレスは管理者のみ変更できます
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="profile-display-name">表示名</Label>
            <Input
              id="profile-display-name"
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              required
              disabled={isLoading || isBootstrapLoading}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="profile-role">現在の権限</Label>
            <Input
              id="profile-role"
              type="text"
              value={currentRole ?? '未設定'}
              disabled
              className="bg-slate-50"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="profile-phone">連絡先電話番号</Label>
            <Input
              id="profile-phone"
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="090-XXXX-XXXX"
              disabled={isLoading || isBootstrapLoading}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="profile-site">所属拠点</Label>
            <Input
              id="profile-site"
              type="text"
              value={currentSiteName ?? '未設定'}
              disabled
              className="bg-slate-50"
            />
          </div>

          <div className="mt-2">
            <Button
              type="submit"
              className="bg-blue-600 hover:bg-blue-700"
              disabled={isLoading || isBootstrapLoading}
              aria-busy={isLoading}
            >
              {isLoading ? '保存中...' : '変更を保存'}
            </Button>
          </div>
        </form>

        {currentRole?.includes('pharmacist') && activitySummary && (
          <div className="mt-8 grid gap-3 md:grid-cols-2">
            <Card size="sm" className="border border-slate-200">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ClipboardList className="h-4 w-4 text-blue-600" aria-hidden="true" />
                  今月の訪問実績
                </CardTitle>
                <CardDescription>完了した訪問記録の件数</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-semibold text-slate-800">
                  {activitySummary.currentMonthVisitCount}件
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  直近30日: {activitySummary.last30DaysVisitCount}件
                </p>
              </CardContent>
            </Card>

            <Card size="sm" className="border border-slate-200">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <CalendarDays className="h-4 w-4 text-blue-600" aria-hidden="true" />
                  担当予定
                </CardTitle>
                <CardDescription>割り当て済みの訪問件数</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-semibold text-slate-800">
                  今日 {activitySummary.todayAssignedCount}件
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  今月の残り予定: {activitySummary.upcomingAssignedCount}件
                </p>
              </CardContent>
            </Card>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// --- Security Tab ---

function SecurityTab() {
  const [mfaEnabled, setMfaEnabled] = useState<boolean | null>(null);
  const [securityError, setSecurityError] = useState<string | null>(null);
  const [isDisablingMfa, setIsDisablingMfa] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function loadSecurityState() {
      try {
        const response = await fetch('/api/me/profile');
        if (!response.ok) {
          const payload = (await response.json().catch(() => null)) as { message?: string } | null;
          throw new Error(payload?.message ?? 'セキュリティ設定の取得に失敗しました。');
        }

        const payload = (await response.json()) as {
          data: {
            mfaEnabled: boolean;
          };
        };

        if (!cancelled) {
          setMfaEnabled(payload.data.mfaEnabled);
        }
      } catch (err) {
        if (!cancelled) {
          setSecurityError(
            err instanceof Error ? err.message : 'セキュリティ設定の取得に失敗しました。'
          );
        }
      }
    }

    void loadSecurityState();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleDisableMfa() {
    setSecurityError(null);
    setIsDisablingMfa(true);

    try {
      const response = await fetch('/api/me/mfa/disable', {
        method: 'DELETE',
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { message?: string } | null;
        throw new Error(payload?.message ?? 'MFAの無効化に失敗しました。');
      }

      setMfaEnabled(false);
      toast.success('MFAを無効化しました');
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'MFAの無効化に失敗しました。';
      setSecurityError(message);
      toast.error(message);
    } finally {
      setIsDisablingMfa(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {/* MFA Status */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-blue-600" aria-hidden="true" />
            二要素認証（MFA）
          </CardTitle>
          <CardDescription>
            認証アプリによる二要素認証の設定状況を確認できます
          </CardDescription>
        </CardHeader>
        <CardContent>
          {securityError && (
            <Alert variant="destructive" className="mb-4">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{securityError}</AlertDescription>
            </Alert>
          )}

          <div className="flex items-center justify-between rounded-lg border p-4">
            <div className="flex items-center gap-3">
              <div
                className={`flex h-10 w-10 items-center justify-center rounded-full ${
                  mfaEnabled ? 'bg-green-100' : 'bg-amber-100'
                }`}
              >
                <ShieldCheck
                  className={`h-5 w-5 ${
                    mfaEnabled ? 'text-green-600' : 'text-amber-600'
                  }`}
                />
              </div>
              <div>
                <p className="text-sm font-medium">
                  TOTP認証（認証アプリ）
                </p>
                <p
                  className={`text-xs ${
                    mfaEnabled ? 'text-green-600' : 'text-amber-600'
                  }`}
                >
                  {mfaEnabled === null ? '確認中' : mfaEnabled ? '有効' : '無効'}
                </p>
              </div>
            </div>

            <Link href="/mfa/setup">
              <Button
                variant={mfaEnabled ? 'outline' : 'default'}
                size="sm"
                className={mfaEnabled ? undefined : 'bg-blue-600 hover:bg-blue-700'}
                disabled={mfaEnabled === null}
              >
                {mfaEnabled ? '再設定' : '設定する'}
              </Button>
            </Link>
          </div>

          {mfaEnabled && (
            <div className="mt-3 flex justify-end">
              <Button
                variant="destructive"
                size="sm"
                onClick={() => void handleDisableMfa()}
                disabled={isDisablingMfa}
              >
                {isDisablingMfa ? '無効化中...' : 'MFAを無効化'}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Password */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="h-5 w-5 text-blue-600" aria-hidden="true" />
            パスワード
          </CardTitle>
          <CardDescription>
            パスワードは定期的に変更することを推奨します
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between rounded-lg border p-4">
            <div>
              <p className="text-sm font-medium">パスワード変更</p>
              <p className="text-xs text-slate-500">
                現在のパスワードで再認証して変更します
              </p>
            </div>
            <Link href="/password/change">
              <Button variant="outline" size="sm">
                変更する
              </Button>
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// --- Notifications Tab ---

interface NotificationSetting {
  id: string;
  label: string;
  description: string;
  enabled: boolean;
}

function NotificationsTab() {
  const [settings, setSettings] = useState<NotificationSetting[]>(() => {
    const defaults: NotificationSetting[] = [
      {
        id: 'visit-reminder',
        label: '訪問リマインド',
        description: '訪問予定の30分前に通知を受け取ります',
        enabled: true,
      },
      {
        id: 'report-deadline',
        label: '報告書期限',
        description: '報告書の提出期限が近づくと通知を受け取ります',
        enabled: true,
      },
      {
        id: 'prescription-new',
        label: '新規処方箋',
        description: '新しい処方箋が登録されたときに通知を受け取ります',
        enabled: true,
      },
      {
        id: 'audit-result',
        label: '鑑査結果',
        description: '鑑査結果が確定したときに通知を受け取ります',
        enabled: false,
      },
      {
        id: 'communication-request',
        label: '連携依頼',
        description: '多職種からの連携依頼を受信したときに通知を受け取ります',
        enabled: true,
      },
      {
        id: 'schedule-change',
        label: 'スケジュール変更',
        description: '訪問スケジュールが変更されたときに通知を受け取ります',
        enabled: false,
      },
      {
        id: 'system-maintenance',
        label: 'システムメンテナンス',
        description: 'メンテナンス予定のお知らせを受け取ります',
        enabled: true,
      },
    ];

    if (typeof window === 'undefined') {
      return defaults;
    }

    const raw = window.localStorage.getItem('careviax:user-notification-settings');
    if (!raw) {
      return defaults;
    }

    try {
      const parsed = JSON.parse(raw) as NotificationSetting[];
      return Array.isArray(parsed) && parsed.length > 0 ? parsed : defaults;
    } catch {
      return defaults;
    }
  });
  const [saved, setSaved] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>(() => {
    if (!isBrowserNotificationSupported()) {
      return 'unsupported';
    }

    return Notification.permission;
  });
  const [browserNotificationsEnabled, setBrowserNotificationsEnabled] = useState(() => {
    if (!isBrowserNotificationSupported()) {
      return false;
    }

    return getBrowserNotificationPreference();
  });

  function toggleSetting(id: string) {
    setSettings((prev) =>
      prev.map((s) => (s.id === id ? { ...s, enabled: !s.enabled } : s))
    );
  }

  async function handleSave() {
    window.localStorage.setItem(
      'careviax:user-notification-settings',
      JSON.stringify(settings)
    );
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  }

  async function handleEnableBrowserNotifications() {
    if (!isBrowserNotificationSupported()) {
      toast.error('このブラウザでは通知権限を利用できません');
      return;
    }

    if (Notification.permission === 'denied') {
      setPermission('denied');
      toast.error('ブラウザ設定で通知を許可してください');
      return;
    }

    const nextPermission =
      Notification.permission === 'granted'
        ? 'granted'
        : await Notification.requestPermission();

    setPermission(nextPermission);
    if (nextPermission !== 'granted') {
      setBrowserNotificationPreference(false);
      setBrowserNotificationsEnabled(false);
      toast.error('通知権限が許可されませんでした');
      return;
    }

    await ensureBrowserNotificationRegistration();
    setBrowserNotificationPreference(true);
    setBrowserNotificationsEnabled(true);
    toast.success('ブラウザ通知を有効化しました');
  }

  function handleDisableBrowserNotifications() {
    setBrowserNotificationPreference(false);
    setBrowserNotificationsEnabled(false);
    toast.success('ブラウザ通知を停止しました');
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bell className="h-5 w-5 text-blue-600" aria-hidden="true" />
          通知設定
        </CardTitle>
        <CardDescription>
          種別ごとに通知の有効/無効を切り替えられます
        </CardDescription>
      </CardHeader>
      <CardContent>
        {saved && (
          <Alert className="mb-4 border-green-200 bg-green-50">
            <Check className="h-4 w-4 text-green-600" />
            <AlertDescription className="text-green-800">
              通知設定を保存しました。
            </AlertDescription>
          </Alert>
        )}

        <div className="mb-6 rounded-lg border p-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-sm font-medium">ブラウザ通知権限</p>
              <p className="mt-1 text-xs text-slate-500">
                権限: {permission === 'unsupported' ? '非対応' : permission} / 状態:{' '}
                {browserNotificationsEnabled ? '有効' : '無効'}
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => void handleEnableBrowserNotifications()}
                disabled={permission === 'unsupported'}
              >
                許可して有効化
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={handleDisableBrowserNotifications}
                disabled={!browserNotificationsEnabled}
              >
                停止
              </Button>
            </div>
          </div>
        </div>

        <div className="flex flex-col divide-y">
          {settings.map((setting) => (
            <div
              key={setting.id}
              className="flex items-center justify-between py-4 first:pt-0 last:pb-0"
            >
              <div className="flex-1 pr-4">
                <label
                  htmlFor={`notif-${setting.id}`}
                  className="text-sm font-medium cursor-pointer"
                >
                  {setting.label}
                </label>
                <p className="text-xs text-slate-500 mt-0.5">
                  {setting.description}
                </p>
              </div>
              <Switch
                id={`notif-${setting.id}`}
                checked={setting.enabled}
                onCheckedChange={() => toggleSetting(setting.id)}
                aria-label={`${setting.label}の通知を${setting.enabled ? '無効' : '有効'}にする`}
              />
            </div>
          ))}
        </div>

        <div className="mt-6">
          <Button
            className="bg-blue-600 hover:bg-blue-700"
            onClick={handleSave}
          >
            設定を保存
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function LocationTab() {
  const [enabled, setEnabled] = useState(() => getVisitLocationTrackingPreference());
  const [permission, setPermission] = useState<VisitLocationPermissionState>('prompt');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void getVisitLocationPermissionState().then(setPermission);
  }, []);

  function handleToggle(nextEnabled: boolean) {
    setEnabled(nextEnabled);
    setVisitLocationTrackingPreference(nextEnabled);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 3000);
    toast.success(
      nextEnabled
        ? '訪問位置情報の記録を有効化しました'
        : '訪問位置情報の記録を停止しました'
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MapPin className="h-5 w-5 text-blue-600" aria-hidden="true" />
          訪問位置情報
        </CardTitle>
        <CardDescription>
          訪問記録入力時に開始/終了の位置を記録するかを端末単位で管理します
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {saved && (
          <Alert className="border-green-200 bg-green-50">
            <Check className="h-4 w-4 text-green-600" />
            <AlertDescription className="text-green-800">
              位置情報設定を保存しました。
            </AlertDescription>
          </Alert>
        )}

        <div className="flex items-center justify-between rounded-lg border p-4">
          <div className="space-y-1 pr-4">
            <p className="text-sm font-medium">開始/終了位置を記録</p>
            <p className="text-xs text-slate-500">
              状態: {enabled ? '有効' : '無効'} / ブラウザ権限: {permission}
            </p>
          </div>
          <Switch
            checked={enabled}
            onCheckedChange={handleToggle}
            aria-label={`訪問位置情報の記録を${enabled ? '無効' : '有効'}にする`}
          />
        </div>

        <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
          <p className="font-medium">記録内容</p>
          <ul className="mt-2 space-y-1 text-xs leading-5 text-slate-600">
            <li>- 訪問記録画面を開いた時点の開始位置</li>
            <li>- 保存時の終了位置</li>
            <li>- 緯度・経度・推定精度</li>
          </ul>
          <p className="mt-2 text-xs leading-5 text-slate-500">
            ブラウザ権限を拒否した場合でも訪問記録の保存自体は継続できます。
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function SessionTab() {
  const { data: session, status } = useSession();
  const [mfaEnabled, setMfaEnabled] = useState<boolean | null>(null);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [isSigningOutAll, setIsSigningOutAll] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function loadProfile() {
      try {
        const response = await fetch('/api/me/profile');
        if (!response.ok) return;

        const payload = (await response.json()) as {
          data: {
            email: string;
            mfaEnabled: boolean;
          };
        };

        if (!cancelled) {
          setMfaEnabled(payload.data.mfaEnabled);
        }
      } catch {
        if (!cancelled) {
          setMfaEnabled(null);
        }
      }
    }

    void loadProfile();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSignOut() {
    setIsSigningOut(true);
    await signOut({ callbackUrl: '/login' });
  }

  async function handleSignOutAll() {
    setIsSigningOutAll(true);

    try {
      const response = await fetch('/api/me/logout-all', {
        method: 'POST',
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { message?: string } | null;
        throw new Error(payload?.message ?? '全端末ログアウトに失敗しました。');
      }

      toast.success('全端末ログアウトを実行しました。再ログインしてください。');
      await signOut({ callbackUrl: '/login' });
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : '全端末ログアウトに失敗しました。'
      );
      setIsSigningOutAll(false);
    }
  }

  const timeoutMinutes = Math.floor(SESSION_TIMEOUT_MS / 60000);
  const warningMinutes = Math.floor(SESSION_WARNING_BEFORE_MS / 60000);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Clock className="h-5 w-5 text-blue-600" aria-hidden="true" />
          セッション管理
        </CardTitle>
        <CardDescription>
          タイムアウト方針と再認証導線を確認できます
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-lg border border-slate-200 p-4">
            <p className="text-sm font-medium text-slate-800">現在のログイン状態</p>
            <p className="mt-2 text-sm text-slate-600">
              {status === 'loading'
                ? '確認中'
                : session?.user?.email ?? session?.user?.name ?? 'セッションなし'}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              MFA: {mfaEnabled === null ? '確認中' : mfaEnabled ? '有効' : '無効'}
            </p>
          </div>

          <div className="rounded-lg border border-slate-200 p-4">
            <p className="text-sm font-medium text-slate-800">タイムアウト方針</p>
            <ul className="mt-2 space-y-1 text-xs leading-5 text-slate-600">
              <li>- 非操作 {timeoutMinutes} 分で自動ログアウト</li>
              <li>- 期限 {warningMinutes} 分前に延長モーダルを表示</li>
              <li>- 延長時は現在のパスワードで再認証</li>
            </ul>
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
          <p className="font-medium">運用メモ</p>
          <ul className="mt-2 space-y-1 text-xs leading-5 text-slate-600">
            <li>- 画面右下のセッション警告モーダルからそのまま延長できます</li>
            <li>- MFA やパスワードの変更は「セキュリティ」タブから行います</li>
            <li>- 共用端末では作業終了時に明示的にログアウトしてください</li>
          </ul>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() => window.location.reload()}
            disabled={isSigningOut || isSigningOutAll}
          >
            状態を再読込
          </Button>
          <Button
            variant="outline"
            onClick={() => void handleSignOutAll()}
            disabled={isSigningOut || isSigningOutAll}
          >
            {isSigningOutAll ? '全端末からログアウト中...' : '全デバイスからログアウト'}
          </Button>
          <Button
            variant="destructive"
            onClick={() => void handleSignOut()}
            disabled={isSigningOut || isSigningOutAll}
          >
            {isSigningOut ? 'ログアウト中...' : 'ログアウト'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// --- Main Settings Content ---

export function SettingsContent() {
  return (
    <div className="flex flex-col gap-6">
      <Tabs defaultValue="profile">
        <TabsList>
          <TabsTrigger value="profile">
            <User className="mr-1.5 h-4 w-4" />
            プロフィール
          </TabsTrigger>
          <TabsTrigger value="session">
            <Clock className="mr-1.5 h-4 w-4" />
            セッション
          </TabsTrigger>
          <TabsTrigger value="security">
            <ShieldCheck className="mr-1.5 h-4 w-4" />
            セキュリティ
          </TabsTrigger>
          <TabsTrigger value="notifications">
            <Bell className="mr-1.5 h-4 w-4" />
            通知
          </TabsTrigger>
          <TabsTrigger value="location">
            <MapPin className="mr-1.5 h-4 w-4" />
            位置情報
          </TabsTrigger>
        </TabsList>

        <TabsContent value="profile">
          <ProfileTab />
        </TabsContent>

        <TabsContent value="session">
          <SessionTab />
        </TabsContent>

        <TabsContent value="security">
          <SecurityTab />
        </TabsContent>

        <TabsContent value="notifications">
          <NotificationsTab />
        </TabsContent>

        <TabsContent value="location">
          <LocationTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
