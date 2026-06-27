'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ErrorState } from '@/components/ui/error-state';
import { Loading } from '@/components/ui/loading';
import { StatCard } from '@/components/ui/stat-card';
import { StatusDot } from '@/components/ui/status-dot';
import { PageSection } from '@/components/layout/page-section';
import { buildOrgHeaders, buildOrgJsonHeaders } from '@/lib/api/org-headers';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { isValidOperatingWindow } from '@/lib/calendar/operating-day';
import type { StatusRole } from '@/lib/constants/status-tokens';

type SiteOption = { id: string; name: string };

type WeeklyRow = {
  id: string | null;
  site_id: string;
  weekday: number;
  is_open: boolean;
  open_time: string | null;
  close_time: string | null;
  note: string | null;
  configured: boolean;
  source: 'stored' | 'default';
  updated_at?: string | null;
};

type ResolvedDay = {
  date: string;
  open: boolean;
  source: 'holiday' | 'weekly' | 'default';
  reason?: 'holiday' | 'regular_closed';
  from: string | null;
  to: string | null;
};

type OperatingHoursResponse = {
  data: {
    site_id: string;
    weekly: WeeklyRow[];
    resolved_days?: ResolvedDay[];
  };
};

type EditableRow = {
  weekday: number;
  is_open: boolean;
  open_time: string;
  close_time: string;
  note: string;
};

const EMPTY_SITES: SiteOption[] = [];
const WEEKDAY_LABELS = ['日', '月', '火', '水', '木', '金', '土'];
const DEFAULT_OPEN = '09:00';
const DEFAULT_CLOSE = '18:00';

function pad2(value: number) {
  return String(value).padStart(2, '0');
}

function monthDateKey(year: number, month: number, day: number) {
  return `${year}-${pad2(month + 1)}-${pad2(day)}`;
}

function getDaysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfWeek(year: number, month: number) {
  return new Date(year, month, 1).getDay();
}

function toEditableRow(row: WeeklyRow): EditableRow {
  return {
    weekday: row.weekday,
    is_open: row.is_open,
    open_time: row.open_time ?? '',
    close_time: row.close_time ?? '',
    note: row.note ?? '',
  };
}

function rowHasError(row: EditableRow): string | null {
  if (!row.is_open) return null;
  if (!row.open_time || !row.close_time) return '営業時間を入力してください';
  if (!isValidOperatingWindow(row.open_time, row.close_time)) {
    return '終了時刻は開始時刻より後にしてください';
  }
  return null;
}

function serializeDraft(rows: EditableRow[]) {
  return JSON.stringify(
    rows.map((row) => ({
      weekday: row.weekday,
      is_open: row.is_open,
      open_time: row.is_open ? row.open_time : '',
      close_time: row.is_open ? row.close_time : '',
      note: row.note,
    })),
  );
}

/** resolved_days の状態を 6 軸トークンへ写像する（営業=neutral は色なし）。 */
function resolvedRole(day: ResolvedDay): StatusRole | null {
  if (day.open) {
    return day.source === 'holiday' ? 'confirm' : null; // 臨時/短縮営業のみ強調
  }
  return day.reason === 'holiday' ? 'blocked' : 'readonly'; // 休業 / 定休
}

function resolvedLabel(day: ResolvedDay): string {
  if (day.open) {
    if (day.source === 'holiday') return '臨時/短縮';
    return day.from && day.to ? `${day.from}〜${day.to}` : '営業';
  }
  return day.reason === 'holiday' ? '休業' : '定休';
}

export function OperatingHoursContent() {
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  const today = new Date();
  const [siteId, setSiteId] = useState('');
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());
  const [draft, setDraft] = useState<EditableRow[]>([]);
  const [baseline, setBaseline] = useState<string>('');
  const [syncedFor, setSyncedFor] = useState<string | null>(null);

  const sitesQuery = useQuery({
    queryKey: ['pharmacy-sites', orgId],
    queryFn: async () => {
      const response = await fetch('/api/pharmacy-sites', {
        headers: buildOrgHeaders(orgId),
      });
      if (!response.ok) throw new Error('薬局拠点の取得に失敗しました');
      return response.json() as Promise<{ data: SiteOption[] }>;
    },
    enabled: !!orgId,
  });

  const sites = sitesQuery.data?.data ?? EMPTY_SITES;
  const activeSiteId = siteId || sites[0]?.id || '';

  const dateFrom = monthDateKey(viewYear, viewMonth, 1);
  const dateTo = monthDateKey(viewYear, viewMonth, getDaysInMonth(viewYear, viewMonth));

  const operatingQuery = useQuery({
    queryKey: ['pharmacy-operating-hours', orgId, activeSiteId, dateFrom, dateTo],
    queryFn: async () => {
      const params = new URLSearchParams({
        site_id: activeSiteId,
        date_from: dateFrom,
        date_to: dateTo,
      });
      const response = await fetch(`/api/pharmacy-operating-hours?${params.toString()}`, {
        headers: buildOrgHeaders(orgId),
      });
      if (!response.ok) throw new Error('営業時間設定の取得に失敗しました');
      return response.json() as Promise<OperatingHoursResponse>;
    },
    enabled: !!orgId && !!activeSiteId,
  });

  // adjust-during-render: 拠点が変わったら draft をサーバ値で初期化する（refetch では上書きしない）。
  const weeklyData = operatingQuery.data?.data.weekly;
  const syncKey = `${activeSiteId}`;
  if (weeklyData && syncedFor !== syncKey) {
    const editable = weeklyData.map(toEditableRow);
    setSyncedFor(syncKey);
    setDraft(editable);
    setBaseline(serializeDraft(editable));
  }

  const saveMutation = useMutation({
    mutationFn: async (rows: EditableRow[]) => {
      const response = await fetch('/api/pharmacy-operating-hours', {
        method: 'PUT',
        headers: buildOrgJsonHeaders(orgId),
        body: JSON.stringify({
          site_id: activeSiteId,
          rows: rows.map((row) => ({
            weekday: row.weekday,
            is_open: row.is_open,
            open_time: row.is_open ? row.open_time : null,
            close_time: row.is_open ? row.close_time : null,
            note: row.note ? row.note : null,
          })),
        }),
      });
      if (!response.ok) {
        const message = await response
          .json()
          .then((body) => body?.message as string | undefined)
          .catch(() => undefined);
        throw new Error(message ?? '営業時間設定の保存に失敗しました');
      }
      return response.json() as Promise<{ data: { site_id: string; weekly: WeeklyRow[] } }>;
    },
    onSuccess: (result) => {
      const editable = result.data.weekly.map(toEditableRow);
      setDraft(editable);
      setBaseline(serializeDraft(editable));
      toast.success('営業時間設定を保存しました');
      void queryClient.invalidateQueries({
        queryKey: ['pharmacy-operating-hours', orgId, activeSiteId],
      });
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  function updateRow(weekday: number, patch: Partial<EditableRow>) {
    setDraft((rows) => rows.map((row) => (row.weekday === weekday ? { ...row, ...patch } : row)));
  }

  function prevMonth() {
    setViewMonth((m) => {
      if (m === 0) {
        setViewYear((y) => y - 1);
        return 11;
      }
      return m - 1;
    });
  }

  function nextMonth() {
    setViewMonth((m) => {
      if (m === 11) {
        setViewYear((y) => y + 1);
        return 0;
      }
      return m + 1;
    });
  }

  if (!orgId || sitesQuery.isLoading) {
    return <Loading />;
  }

  if (sitesQuery.isError) {
    return (
      <ErrorState
        variant="server"
        size="inline"
        description="薬局拠点を取得できませんでした。"
        action={{ label: '再読み込み', onClick: () => void sitesQuery.refetch() }}
      />
    );
  }

  if (sites.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>薬局拠点が登録されていません</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>先に薬局拠点を登録すると、稼働日設定を編集できます。</p>
          <Button asChild variant="outline">
            <a href="/admin/pharmacy-sites">薬局情報へ</a>
          </Button>
        </CardContent>
      </Card>
    );
  }

  const rowErrors = draft.map(rowHasError);
  const hasError = rowErrors.some((error) => error !== null);
  const isSynced = syncedFor === syncKey && draft.length > 0;
  const isDirty = isSynced && serializeDraft(draft) !== baseline;
  const canSave = isSynced && isDirty && !hasError && !saveMutation.isPending;

  const resolvedDays = operatingQuery.data?.data.resolved_days ?? [];
  const resolvedByDate = new Map(resolvedDays.map((day) => [day.date, day]));
  const openCount = resolvedDays.filter((day) => day.open).length;
  const regularClosedCount = resolvedDays.filter(
    (day) => !day.open && day.reason === 'regular_closed',
  ).length;
  const holidayClosedCount = resolvedDays.filter(
    (day) => !day.open && day.reason === 'holiday',
  ).length;

  const firstWeekday = getFirstDayOfWeek(viewYear, viewMonth);
  const daysInMonth = getDaysInMonth(viewYear, viewMonth);
  const calendarCells: Array<number | null> = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: daysInMonth }, (_, index) => index + 1),
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label htmlFor="operating-hours-site">対象拠点</Label>
          <Select value={activeSiteId} onValueChange={(value) => setSiteId(value ?? '')}>
            <SelectTrigger id="operating-hours-site" className="min-h-[44px] w-64">
              <SelectValue>{sites.find((site) => site.id === activeSiteId)?.name}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {sites.map((site) => (
                <SelectItem key={site.id} value={site.id}>
                  {site.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <PageSection
        title="週次の営業時間"
        description="曜日ごとに営業/定休と営業時間を設定します。定期訪問は原則この稼働日内で計画されます。"
        actions={
          <Button type="button" onClick={() => saveMutation.mutate(draft)} disabled={!canSave}>
            {saveMutation.isPending ? '保存中…' : '保存'}
          </Button>
        }
      >
        {operatingQuery.isLoading ? (
          <Loading />
        ) : operatingQuery.isError ? (
          <ErrorState
            variant="server"
            size="inline"
            description="営業時間設定を取得できませんでした。"
            action={{ label: '再読み込み', onClick: () => void operatingQuery.refetch() }}
          />
        ) : (
          <div className="space-y-2">
            {draft.map((row) => {
              const error = rowErrors[row.weekday];
              return (
                <div
                  key={row.weekday}
                  className="flex flex-wrap items-center gap-3 rounded-md border border-border/70 bg-card p-3"
                >
                  <span className="w-10 text-sm font-medium">{WEEKDAY_LABELS[row.weekday]}</span>
                  <label className="flex items-center gap-2 text-sm">
                    <Switch
                      checked={row.is_open}
                      onCheckedChange={(checked) => updateRow(row.weekday, { is_open: checked })}
                    />
                    <span>{row.is_open ? '営業' : '定休'}</span>
                  </label>
                  <div className="flex items-center gap-2">
                    <Input
                      type="time"
                      aria-label={`${WEEKDAY_LABELS[row.weekday]}曜日の開始時刻`}
                      className="w-32"
                      value={row.open_time}
                      disabled={!row.is_open}
                      onChange={(event) =>
                        updateRow(row.weekday, {
                          open_time: event.target.value,
                          close_time: row.close_time || (event.target.value ? DEFAULT_CLOSE : ''),
                        })
                      }
                    />
                    <span className="text-muted-foreground">〜</span>
                    <Input
                      type="time"
                      aria-label={`${WEEKDAY_LABELS[row.weekday]}曜日の終了時刻`}
                      className="w-32"
                      value={row.close_time}
                      disabled={!row.is_open}
                      onChange={(event) =>
                        updateRow(row.weekday, { close_time: event.target.value })
                      }
                    />
                  </div>
                  {!row.is_open && !row.open_time ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        updateRow(row.weekday, {
                          is_open: true,
                          open_time: DEFAULT_OPEN,
                          close_time: DEFAULT_CLOSE,
                        })
                      }
                    >
                      営業にする
                    </Button>
                  ) : null}
                  {error ? <span className="text-sm text-state-blocked">{error}</span> : null}
                </div>
              );
            })}
          </div>
        )}
      </PageSection>

      <PageSection
        title="稼働日カレンダー"
        description="営業時間・定休・休業日を反映した実際の稼働日です。休業日は休日カレンダーで編集します。"
        actions={
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={prevMonth} aria-label="前月">
              <ChevronLeft className="size-4" />
            </Button>
            <span className="min-w-24 text-center text-sm font-medium">
              {viewYear}年{viewMonth + 1}月
            </span>
            <Button type="button" variant="outline" size="sm" onClick={nextMonth} aria-label="翌月">
              <ChevronRight className="size-4" />
            </Button>
          </div>
        }
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <StatCard label="営業日" value={openCount} unit="日" role="done" />
          <StatCard label="定休" value={regularClosedCount} unit="日" role="readonly" />
          <StatCard label="休業日" value={holidayClosedCount} unit="日" role="blocked" />
        </div>

        <div className="mt-4 flex flex-wrap gap-4 text-xs text-muted-foreground">
          <StatusDot role="readonly" label="定休" />
          <StatusDot role="blocked" label="休業" />
          <StatusDot role="confirm" label="臨時/短縮営業" />
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-muted-foreground/40" />
            営業
          </span>
        </div>

        {operatingQuery.isError ? (
          <ErrorState
            variant="server"
            size="inline"
            description="稼働日カレンダーを取得できませんでした。"
            action={{ label: '再読み込み', onClick: () => void operatingQuery.refetch() }}
          />
        ) : (
          <div className="mt-4 grid grid-cols-7 gap-px overflow-hidden rounded-md border border-border/70 bg-border/70">
            {WEEKDAY_LABELS.map((label, index) => (
              <div
                key={label}
                className={`bg-card py-1 text-center text-xs font-medium ${
                  index === 0 ? 'text-state-blocked' : index === 6 ? 'text-tag-info' : ''
                }`}
              >
                {label}
              </div>
            ))}
            {calendarCells.map((day, index) => {
              if (day === null) {
                return <div key={`empty-${index}`} className="min-h-16 bg-card" />;
              }
              const key = monthDateKey(viewYear, viewMonth, day);
              const resolved = resolvedByDate.get(key);
              const role = resolved ? resolvedRole(resolved) : null;
              return (
                <div
                  key={key}
                  className={`min-h-16 bg-card p-1 ${role ? 'border-l-4 ' : ''}${
                    role === 'blocked'
                      ? 'border-l-state-blocked'
                      : role === 'readonly'
                        ? 'border-l-state-readonly'
                        : role === 'confirm'
                          ? 'border-l-state-confirm'
                          : ''
                  }`}
                >
                  <div className="text-xs font-medium">{day}</div>
                  {resolved ? (
                    <div
                      className={`mt-1 text-[11px] ${
                        role === 'blocked'
                          ? 'text-state-blocked'
                          : role === 'readonly'
                            ? 'text-muted-foreground'
                            : role === 'confirm'
                              ? 'text-state-confirm'
                              : 'text-muted-foreground'
                      }`}
                    >
                      {resolvedLabel(resolved)}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </PageSection>
    </div>
  );
}
