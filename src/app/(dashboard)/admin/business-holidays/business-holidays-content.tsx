'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
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
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { buildOrgHeaders, buildOrgJsonHeaders } from '@/lib/api/org-headers';
import { formatDateKey } from '@/lib/date-key';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { encodePathSegment } from '@/lib/http/path-segment';

type Holiday = {
  id: string;
  org_id: string;
  site_id: string | null;
  date: string;
  name: string;
  holiday_type: string;
  is_closed: boolean;
  site?: { id: string; name: string } | null;
};

type SiteOption = {
  id: string;
  name: string;
};

type HolidayForm = {
  site_id: string;
  date: string;
  name: string;
  holiday_type: string;
  is_closed: boolean;
};

const EMPTY_FORM: HolidayForm = {
  site_id: '',
  date: '',
  name: '',
  holiday_type: 'site_closure',
  is_closed: true,
};

const EMPTY_HOLIDAYS: Holiday[] = [];
const EMPTY_SITES: SiteOption[] = [];

const HOLIDAY_TYPE_OPTIONS = [
  ['public_holiday', '祝日'],
  ['site_closure', '薬局休業日'],
  ['org_event', '法人イベント'],
] as const;

const HOLIDAY_TYPE_LABELS: Record<string, string> = Object.fromEntries(HOLIDAY_TYPE_OPTIONS);

const WEEKDAY_LABELS = ['日', '月', '火', '水', '木', '金', '土'];

function formatYearMonth(year: number, month: number) {
  return `${year}年${month + 1}月`;
}

function getDaysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfWeek(year: number, month: number) {
  return new Date(year, month, 1).getDay();
}

function dateKey(d: Date | string) {
  const date = typeof d === 'string' ? new Date(d) : d;
  return formatDateKey(date);
}

function holidaySummary(holiday: Holiday | null) {
  if (!holiday) return '選択中の休日設定';
  return `${dateKey(holiday.date)} ${holiday.name}（${[
    holiday.site?.name ?? '全店舗共通',
    HOLIDAY_TYPE_LABELS[holiday.holiday_type] ?? holiday.holiday_type,
    holiday.is_closed ? '休業' : '営業',
  ].join(' / ')}）`;
}

export function BusinessHolidaysContent() {
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  const today = new Date();
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());
  const [form, setForm] = useState<HolidayForm>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Holiday | null>(null);
  const [bulkMode, setBulkMode] = useState(false);
  const [bulkDates, setBulkDates] = useState<Set<string>>(new Set());
  const [bulkName, setBulkName] = useState('');
  const [bulkType, setBulkType] = useState('site_closure');
  const [bulkSiteId, setBulkSiteId] = useState('');
  const [filterSiteId, setFilterSiteId] = useState<string>('');

  const dateFrom = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-01`;
  const dateToMonth = viewMonth === 11 ? 0 : viewMonth + 1;
  const dateToYear = viewMonth === 11 ? viewYear + 1 : viewYear;
  const dateTo = `${dateToYear}-${String(dateToMonth + 1).padStart(2, '0')}-01`;

  const { data, isLoading } = useQuery({
    queryKey: ['business-holidays', orgId, dateFrom, dateTo, filterSiteId],
    queryFn: async () => {
      const params = new URLSearchParams({ date_from: dateFrom, date_to: dateTo });
      if (filterSiteId) params.set('site_id', filterSiteId);
      const response = await fetch(`/api/business-holidays?${params}`, {
        headers: buildOrgHeaders(orgId),
      });
      if (!response.ok) throw new Error('休日設定の取得に失敗しました');
      return response.json() as Promise<{ data: Holiday[] }>;
    },
    enabled: !!orgId,
  });

  const sitesQuery = useQuery({
    queryKey: ['pharmacy-sites', orgId],
    queryFn: async () => {
      const response = await fetch('/api/pharmacy-sites', {
        headers: buildOrgHeaders(orgId),
      });
      if (!response.ok) throw new Error('店舗一覧の取得に失敗しました');
      return response.json() as Promise<{ data: SiteOption[] }>;
    },
    enabled: !!orgId,
  });

  const holidays = data?.data ?? EMPTY_HOLIDAYS;
  const sites = sitesQuery.data?.data ?? EMPTY_SITES;

  const holidayMap = useMemo(() => {
    const map = new Map<string, Holiday[]>();
    for (const h of holidays) {
      const key = dateKey(h.date);
      const list = map.get(key) ?? [];
      list.push(h);
      map.set(key, list);
    }
    return map;
  }, [holidays]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const url = editingId
        ? `/api/business-holidays/${encodePathSegment(editingId)}`
        : '/api/business-holidays';
      const method = editingId ? 'PATCH' : 'POST';
      const response = await fetch(url, {
        method,
        headers: buildOrgJsonHeaders(orgId),
        body: JSON.stringify({
          ...form,
          site_id: form.site_id || undefined,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error((payload as { message?: string }).message ?? '保存に失敗しました');
      }
      return payload;
    },
    onSuccess: async () => {
      toast.success(editingId ? '休日設定を更新しました' : '休日を登録しました');
      setShowForm(false);
      setForm(EMPTY_FORM);
      setEditingId(null);
      await queryClient.invalidateQueries({ queryKey: ['business-holidays', orgId] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : '保存に失敗しました');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      if (!deleteTarget) throw new Error('削除対象がありません');
      const response = await fetch(`/api/business-holidays/${encodePathSegment(deleteTarget.id)}`, {
        method: 'DELETE',
        headers: buildOrgHeaders(orgId),
      });
      if (!response.ok) throw new Error('削除に失敗しました');
    },
    onSuccess: async () => {
      toast.success('休日を削除しました');
      setDeleteTarget(null);
      await queryClient.invalidateQueries({ queryKey: ['business-holidays', orgId] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : '削除に失敗しました');
    },
  });

  const bulkMutation = useMutation({
    mutationFn: async () => {
      const dates = Array.from(bulkDates).sort();
      const results = [];
      const headers = buildOrgJsonHeaders(orgId);
      for (const date of dates) {
        const response = await fetch('/api/business-holidays', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            date,
            name: bulkName,
            holiday_type: bulkType,
            is_closed: true,
            site_id: bulkSiteId || undefined,
          }),
        });
        results.push({ date, ok: response.ok });
      }
      const failed = results.filter((r) => !r.ok);
      if (failed.length > 0) {
        throw new Error(`${failed.length}件の登録に失敗しました`);
      }
    },
    onSuccess: async () => {
      toast.success(`${bulkDates.size}件の休日を一括登録しました`);
      setBulkMode(false);
      setBulkDates(new Set());
      setBulkName('');
      setBulkType('site_closure');
      setBulkSiteId('');
      await queryClient.invalidateQueries({ queryKey: ['business-holidays', orgId] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : '一括登録に失敗しました');
    },
  });

  function prevMonth() {
    if (viewMonth === 0) {
      setViewYear((y) => y - 1);
      setViewMonth(11);
    } else setViewMonth((m) => m - 1);
  }
  function nextMonth() {
    if (viewMonth === 11) {
      setViewYear((y) => y + 1);
      setViewMonth(0);
    } else setViewMonth((m) => m + 1);
  }

  function openEdit(holiday: Holiday) {
    setEditingId(holiday.id);
    setForm({
      site_id: holiday.site_id ?? '',
      date: dateKey(holiday.date),
      name: holiday.name,
      holiday_type: holiday.holiday_type,
      is_closed: holiday.is_closed,
    });
    setShowForm(true);
  }

  function handleDateClick(dateStr: string) {
    if (bulkMode) {
      setBulkDates((prev) => {
        const next = new Set(prev);
        if (next.has(dateStr)) next.delete(dateStr);
        else next.add(dateStr);
        return next;
      });
      return;
    }
    setForm({ ...EMPTY_FORM, date: dateStr });
    setEditingId(null);
    setShowForm(true);
  }

  const daysInMonth = getDaysInMonth(viewYear, viewMonth);
  const firstDow = getFirstDayOfWeek(viewYear, viewMonth);

  const calendarCells: Array<{ day: number | null; dateStr: string }> = [];
  for (let i = 0; i < firstDow; i++) calendarCells.push({ day: null, dateStr: '' });
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    calendarCells.push({ day: d, dateStr });
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-3">
        <SummaryCard label="今月の休日数" value={holidays.length} />
        <SummaryCard label="休業日" value={holidays.filter((h) => h.is_closed).length} />
        <SummaryCard label="営業日" value={holidays.filter((h) => !h.is_closed).length} />
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Button size="icon" variant="ghost" aria-label="前月を表示" onClick={prevMonth}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <CardTitle className="text-base">{formatYearMonth(viewYear, viewMonth)}</CardTitle>
              <Button size="icon" variant="ghost" aria-label="翌月を表示" onClick={nextMonth}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
            <div className="flex items-center gap-2">
              <Select value={filterSiteId} onValueChange={(v) => setFilterSiteId(v ?? '')}>
                <SelectTrigger className="w-40" aria-label="店舗フィルタ">
                  <SelectValue placeholder="全店舗" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all">全店舗</SelectItem>
                  {sites.map((site) => (
                    <SelectItem key={site.id} value={site.id}>
                      {site.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                size="sm"
                variant={bulkMode ? 'default' : 'outline'}
                onClick={() => {
                  setBulkMode(!bulkMode);
                  setBulkDates(new Set());
                }}
              >
                {bulkMode ? '一括モード中' : '一括登録'}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-sm text-muted-foreground">読み込み中...</div>
          ) : (
            <div className="grid grid-cols-7 gap-px rounded-lg border border-border bg-border">
              {WEEKDAY_LABELS.map((label, i) => (
                <div
                  key={label}
                  className={`bg-muted px-2 py-1.5 text-center text-xs font-medium ${
                    i === 0 ? 'text-red-500' : i === 6 ? 'text-blue-500' : 'text-muted-foreground'
                  }`}
                >
                  {label}
                </div>
              ))}
              {calendarCells.map((cell, i) => {
                if (cell.day === null) {
                  return <div key={`empty-${i}`} className="min-h-[80px] bg-background" />;
                }
                const dayHolidays = holidayMap.get(cell.dateStr) ?? [];
                const isSelected = bulkMode && bulkDates.has(cell.dateStr);
                const dow = new Date(cell.dateStr).getDay();
                return (
                  <div
                    key={cell.dateStr}
                    role="button"
                    tabIndex={0}
                    aria-label={`${cell.day}日`}
                    aria-pressed={bulkMode ? isSelected : undefined}
                    className={`min-h-[80px] cursor-pointer bg-background p-1 transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset ${
                      isSelected ? 'ring-2 ring-primary ring-inset' : ''
                    }`}
                    onClick={() => handleDateClick(cell.dateStr)}
                    onKeyDown={(event) => {
                      // 日セルをキーボードでも選択可能にする(Enter/Space)
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        handleDateClick(cell.dateStr);
                      }
                    }}
                  >
                    <div
                      className={`text-xs font-medium ${
                        dow === 0 ? 'text-red-500' : dow === 6 ? 'text-blue-500' : ''
                      }`}
                    >
                      {cell.day}
                    </div>
                    <div className="mt-0.5 space-y-0.5">
                      {dayHolidays.map((h) => (
                        <button
                          key={h.id}
                          type="button"
                          className={`block w-full truncate rounded px-1 text-left text-[10px] leading-4 ${
                            h.is_closed
                              ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                              : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                          }`}
                          onClick={(e) => {
                            e.stopPropagation();
                            openEdit(h);
                          }}
                          title={`${h.name} (${HOLIDAY_TYPE_LABELS[h.holiday_type] ?? h.holiday_type})`}
                        >
                          {h.name}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Bulk registration panel */}
      {bulkMode && bulkDates.size > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">一括登録 ({bulkDates.size}日選択中)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-1">
              {Array.from(bulkDates)
                .sort()
                .map((d) => (
                  <Badge key={d} variant="secondary">
                    {d}
                  </Badge>
                ))}
            </div>
            <div className="grid gap-4 md:grid-cols-3">
              <Field label="休日名" htmlFor="bulk-holiday-name">
                <Input
                  id="bulk-holiday-name"
                  value={bulkName}
                  onChange={(e) => setBulkName(e.target.value)}
                  placeholder="例: 年末年始休業"
                />
              </Field>
              <Field label="種別" htmlFor="bulk-holiday-type">
                <Select value={bulkType} onValueChange={(v) => setBulkType(v ?? '')}>
                  <SelectTrigger id="bulk-holiday-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {HOLIDAY_TYPE_OPTIONS.map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="対象店舗" htmlFor="bulk-holiday-site">
                <Select value={bulkSiteId} onValueChange={(v) => setBulkSiteId(v ?? '')}>
                  <SelectTrigger id="bulk-holiday-site">
                    <SelectValue placeholder="全店舗共通" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all">全店舗共通</SelectItem>
                    {sites.map((site) => (
                      <SelectItem key={site.id} value={site.id}>
                        {site.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setBulkMode(false);
                  setBulkDates(new Set());
                }}
              >
                キャンセル
              </Button>
              <Button
                onClick={() => bulkMutation.mutate()}
                disabled={bulkMutation.isPending || !bulkName.trim()}
              >
                {bulkMutation.isPending ? '登録中...' : `${bulkDates.size}件を一括登録`}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Holiday list */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">休日一覧</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {holidays.length === 0 ? (
            <div className="text-sm text-muted-foreground">この月の休日設定はありません。</div>
          ) : (
            holidays.map((h) => (
              <div key={h.id} className="flex items-center justify-between rounded-lg border p-3">
                <div className="flex items-center gap-3">
                  <div className="text-sm font-medium">{dateKey(h.date)}</div>
                  <div className="text-sm">{h.name}</div>
                  <Badge variant="outline">
                    {HOLIDAY_TYPE_LABELS[h.holiday_type] ?? h.holiday_type}
                  </Badge>
                  {h.is_closed ? (
                    <Badge variant="destructive">休業</Badge>
                  ) : (
                    <Badge variant="secondary">営業</Badge>
                  )}
                  {h.site?.name && (
                    <span className="text-xs text-muted-foreground">{h.site.name}</span>
                  )}
                </div>
                <div className="flex gap-1">
                  <Button
                    size="sm"
                    variant="outline"
                    aria-label={`${holidaySummary(h)}を編集`}
                    onClick={() => openEdit(h)}
                  >
                    編集
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => setDeleteTarget(h)}
                    aria-label={`${holidaySummary(h)}を削除`}
                  >
                    削除
                  </Button>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {/* Add/Edit Form Sheet */}
      <Sheet
        open={showForm}
        onOpenChange={(open) => {
          if (!open) {
            setShowForm(false);
            setForm(EMPTY_FORM);
            setEditingId(null);
          }
        }}
      >
        <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>{editingId ? '休日を編集' : '休日を追加'}</SheetTitle>
            <SheetDescription>休日情報を入力してください。</SheetDescription>
          </SheetHeader>
          <div className="mt-6 space-y-4">
            <Field label="日付" htmlFor="holiday-form-date">
              <Input
                id="holiday-form-date"
                type="date"
                value={form.date}
                onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
              />
            </Field>
            <Field label="休日名" htmlFor="holiday-form-name">
              <Input
                id="holiday-form-name"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="例: 元日"
              />
            </Field>
            <Field label="種別" htmlFor="holiday-form-type">
              <Select
                value={form.holiday_type}
                onValueChange={(v) => setForm((f) => ({ ...f, holiday_type: v ?? '' }))}
              >
                <SelectTrigger id="holiday-form-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {HOLIDAY_TYPE_OPTIONS.map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="対象店舗" htmlFor="holiday-form-site">
              <Select
                value={form.site_id}
                onValueChange={(v) =>
                  setForm((f) => ({ ...f, site_id: v === '__all' ? '' : (v ?? '') }))
                }
              >
                <SelectTrigger id="holiday-form-site">
                  <SelectValue placeholder="全店舗共通" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all">全店舗共通</SelectItem>
                  {sites.map((site) => (
                    <SelectItem key={site.id} value={site.id}>
                      {site.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={form.is_closed}
                onCheckedChange={(c) => setForm((f) => ({ ...f, is_closed: c === true }))}
              />
              休業日として扱う
            </label>
            <div className="flex justify-end gap-2 pt-4">
              <Button
                variant="outline"
                onClick={() => {
                  setShowForm(false);
                  setForm(EMPTY_FORM);
                  setEditingId(null);
                }}
              >
                キャンセル
              </Button>
              <Button
                onClick={() => saveMutation.mutate()}
                disabled={saveMutation.isPending || !form.date || !form.name.trim()}
              >
                {saveMutation.isPending ? '保存中...' : editingId ? '更新する' : '登録する'}
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title="休日設定を削除しますか"
        description={`${holidaySummary(
          deleteTarget,
        )}を削除します。この操作は取り消せません。シフト表と訪問可能日の表示にも反映されます。`}
        confirmLabel={deleteMutation.isPending ? '削除中...' : '削除する'}
        confirmDisabled={deleteMutation.isPending}
        closeOnConfirm={false}
        variant="destructive"
        onConfirm={() => {
          if (deleteTarget) deleteMutation.mutate();
        }}
      />
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
    <div>
      <Label htmlFor={htmlFor} className="mb-1.5 block">
        {label}
      </Label>
      {children}
    </div>
  );
}
