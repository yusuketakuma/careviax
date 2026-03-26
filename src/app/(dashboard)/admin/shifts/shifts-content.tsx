'use client';

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  format,
  getDay,
  parseISO,
  startOfMonth,
  subMonths,
} from 'date-fns';
import { ja } from 'date-fns/locale';
import { CalendarPlus2, Check, ChevronLeft, ChevronRight, UserPlus, X } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
import { Textarea } from '@/components/ui/textarea';
import { useOrgId } from '@/lib/hooks/use-org-id';
import {
  buildShiftGrid,
  cellKey,
  formatCapacitySummary,
  formatListInput,
  holidayAppliesToSite,
  parseListInput,
  pharmacistStatusClass,
  pharmacistStatusLabel,
  toDateKey,
  toOptionalNumber,
  toTimeValue,
  WEEKDAY_OPTIONS,
  weekdayLabel,
  type BusinessHoliday,
  type Pharmacist,
  type PharmacistAction,
  type PharmacySite,
  type ShiftCell,
  type ShiftRecord,
  type ShiftTemplate,
} from './shifts-content.shared';

export function ShiftsContent() {
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  const [currentMonth, setCurrentMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [editMode, setEditMode] = useState(false);
  const [draftShifts, setDraftShifts] = useState<ShiftCell[]>([]);
  const [selectedShiftKey, setSelectedShiftKey] = useState<string | null>(null);
  const [pharmacistDialogOpen, setPharmacistDialogOpen] = useState(false);
  const [pharmacistDialogMode, setPharmacistDialogMode] = useState<'create' | 'edit'>('create');
  const [editingPharmacistId, setEditingPharmacistId] = useState<string | null>(null);
  const [pharmacistForm, setPharmacistForm] = useState({
    name: '',
    name_kana: '',
    email: '',
    phone: '',
    site_id: '',
    role: 'pharmacist' as 'pharmacist' | 'pharmacist_trainee' | 'admin',
    max_daily_visits: '',
    max_weekly_visits: '',
    max_travel_minutes: '',
    can_accept_emergency: true,
    visit_specialties: '',
    coverage_area: '',
  });
  const [templateForm, setTemplateForm] = useState({
    user_id: '',
    site_id: '',
    weekday: '1',
    available: true,
    available_from: '09:00',
    available_to: '18:00',
    note: '',
  });
  const [templateApplyMonth, setTemplateApplyMonth] = useState(format(new Date(), 'yyyy-MM'));
  const [templateApplyUserId, setTemplateApplyUserId] = useState('all');
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);
  const [pharmacistActionTarget, setPharmacistActionTarget] = useState<{
    pharmacist: Pharmacist;
    action: PharmacistAction;
  } | null>(null);
  const [pharmacistActionReason, setPharmacistActionReason] = useState('');
  const [holidayForm, setHolidayForm] = useState({
    date: format(new Date(), 'yyyy-MM-dd'),
    site_scope: 'org',
    site_id: '',
    name: '',
    holiday_type: 'public_holiday' as 'public_holiday' | 'site_closure' | 'org_event',
    is_closed: 'true',
  });
  const [editingHoliday, setEditingHoliday] = useState<BusinessHoliday | null>(null);
  const [holidayEditForm, setHolidayEditForm] = useState({
    date: format(new Date(), 'yyyy-MM-dd'),
    site_scope: 'org',
    site_id: '',
    name: '',
    holiday_type: 'public_holiday' as 'public_holiday' | 'site_closure' | 'org_event',
    is_closed: 'true',
  });

  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(currentMonth);
  const monthLabel = format(currentMonth, 'yyyy年M月', { locale: ja });

  const { data: sitesData } = useQuery({
    queryKey: ['pharmacy-sites', orgId],
    queryFn: async () => {
      const res = await fetch('/api/pharmacy-sites', {
        headers: { 'x-org-id': orgId },
      });
      if (!res.ok) throw new Error('店舗情報の取得に失敗しました');
      return res.json() as Promise<{ data: PharmacySite[] }>;
    },
    enabled: !!orgId,
  });

  const { data: pharmacistsData, isLoading: pharmacistsLoading } = useQuery({
    queryKey: ['pharmacists', orgId, 'admin-shifts'],
    queryFn: async () => {
      const res = await fetch('/api/pharmacists', {
        headers: { 'x-org-id': orgId },
      });
      if (!res.ok) throw new Error('薬剤師一覧の取得に失敗しました');
      return res.json() as Promise<{ data: Pharmacist[] }>;
    },
    enabled: !!orgId,
  });

  const { data: shiftsData, isLoading: shiftsLoading } = useQuery({
    queryKey: ['pharmacist-shifts', orgId, format(currentMonth, 'yyyy-MM')],
    queryFn: async () => {
      const month = format(currentMonth, 'yyyy-MM-01');
      const res = await fetch(`/api/pharmacist-shifts?month=${month}&limit=400`, {
        headers: { 'x-org-id': orgId },
      });
      if (!res.ok) throw new Error('シフトの取得に失敗しました');
      return res.json() as Promise<{ data: ShiftRecord[] }>;
    },
    enabled: !!orgId,
  });

  const { data: holidaysData } = useQuery({
    queryKey: [
      'business-holidays',
      orgId,
      format(monthStart, 'yyyy-MM-dd'),
      format(monthEnd, 'yyyy-MM-dd'),
    ],
    queryFn: async () => {
      const params = new URLSearchParams({
        date_from: format(monthStart, 'yyyy-MM-dd'),
        date_to: format(monthEnd, 'yyyy-MM-dd'),
      });
      const res = await fetch(`/api/business-holidays?${params}`, {
        headers: { 'x-org-id': orgId },
      });
      if (!res.ok) throw new Error('休日設定の取得に失敗しました');
      return res.json() as Promise<{ data: BusinessHoliday[] }>;
    },
    enabled: !!orgId,
  });

  const { data: templatesData } = useQuery({
    queryKey: ['pharmacist-shift-templates', orgId],
    queryFn: async () => {
      const res = await fetch('/api/pharmacist-shift-templates', {
        headers: { 'x-org-id': orgId },
      });
      if (!res.ok) throw new Error('定型シフトの取得に失敗しました');
      return res.json() as Promise<{ data: ShiftTemplate[] }>;
    },
    enabled: !!orgId,
  });

  const pharmacists = useMemo(() => pharmacistsData?.data ?? [], [pharmacistsData]);
  const sites = useMemo(() => sitesData?.data ?? [], [sitesData]);
  const siteById = useMemo(() => new Map(sites.map((site) => [site.id, site])), [sites]);
  const shifts = useMemo(() => shiftsData?.data ?? [], [shiftsData]);
  const holidays = useMemo(() => holidaysData?.data ?? [], [holidaysData]);
  const templates = useMemo(() => templatesData?.data ?? [], [templatesData]);
  const baselineShifts = useMemo(
    () =>
      buildShiftGrid({
        pharmacists,
        sitesById: siteById,
        month: currentMonth,
        shifts,
      }),
    [currentMonth, pharmacists, shifts, siteById],
  );
  const baselineShiftByKey = useMemo(
    () => new Map(baselineShifts.map((shift) => [shift.key, shift])),
    [baselineShifts],
  );
  const holidaysByDate = useMemo(() => {
    const map = new Map<string, BusinessHoliday[]>();
    for (const holiday of holidays) {
      const key = toDateKey(holiday.date);
      const current = map.get(key);
      if (current) current.push(holiday);
      else map.set(key, [holiday]);
    }
    return map;
  }, [holidays]);

  const visibleShifts = editMode ? draftShifts : baselineShifts;
  const visibleShiftByKey = useMemo(
    () => new Map(visibleShifts.map((shift) => [shift.key, shift])),
    [visibleShifts],
  );
  const selectedShift = selectedShiftKey
    ? (draftShifts.find((shift) => shift.key === selectedShiftKey) ?? null)
    : null;
  const days = eachDayOfInterval({ start: monthStart, end: monthEnd });

  useEffect(() => {
    setTemplateApplyMonth(format(currentMonth, 'yyyy-MM'));
  }, [currentMonth]);

  useEffect(() => {
    if (pharmacists.length === 0 || sites.length === 0) return;

    setTemplateForm((current) => ({
      ...current,
      user_id: current.user_id || pharmacists[0]?.id || '',
      site_id: current.site_id || sites[0]?.id || '',
    }));
  }, [pharmacists, sites]);

  function updateDraftShift(targetKey: string, updater: (shift: ShiftCell) => ShiftCell) {
    setDraftShifts((current) =>
      current.map((shift) => (shift.key === targetKey ? updater(shift) : shift)),
    );
  }

  function openPharmacistDialog() {
    setPharmacistDialogMode('create');
    setEditingPharmacistId(null);
    setPharmacistForm((current) => ({
      name: '',
      name_kana: '',
      email: '',
      phone: '',
      site_id: current.site_id || sites[0]?.id || '',
      role: 'pharmacist',
      max_daily_visits: '',
      max_weekly_visits: '',
      max_travel_minutes: '',
      can_accept_emergency: true,
      visit_specialties: '',
      coverage_area: '',
    }));
    setPharmacistDialogOpen(true);
  }

  function openPharmacistEditDialog(pharmacist: Pharmacist) {
    setPharmacistDialogMode('edit');
    setEditingPharmacistId(pharmacist.id);
    setPharmacistForm({
      name: pharmacist.name,
      name_kana: pharmacist.name_kana ?? '',
      email: pharmacist.email,
      phone: pharmacist.phone ?? '',
      site_id: pharmacist.site_id ?? sites[0]?.id ?? '',
      role:
        pharmacist.role === 'owner'
          ? 'admin'
          : pharmacist.role === 'admin'
            ? 'admin'
            : pharmacist.role,
      max_daily_visits: pharmacist.max_daily_visits?.toString() ?? '',
      max_weekly_visits: pharmacist.max_weekly_visits?.toString() ?? '',
      max_travel_minutes: pharmacist.max_travel_minutes?.toString() ?? '',
      can_accept_emergency: pharmacist.can_accept_emergency,
      visit_specialties: formatListInput(pharmacist.visit_specialties),
      coverage_area: formatListInput(pharmacist.coverage_area),
    });
    setPharmacistDialogOpen(true);
  }

  function loadTemplateIntoForm(template: ShiftTemplate) {
    setEditingTemplateId(template.id);
    setTemplateForm({
      user_id: template.user_id,
      site_id: template.site_id,
      weekday: String(template.weekday),
      available: template.available,
      available_from: toTimeValue(template.available_from) || '09:00',
      available_to: toTimeValue(template.available_to) || '18:00',
      note: template.note ?? '',
    });
  }

  function resetTemplateForm() {
    setEditingTemplateId(null);
    setTemplateForm({
      user_id: pharmacists[0]?.id ?? '',
      site_id: sites[0]?.id ?? '',
      weekday: '1',
      available: true,
      available_from: '09:00',
      available_to: '18:00',
      note: '',
    });
  }

  function openHolidayEditDialog(holiday: BusinessHoliday) {
    setEditingHoliday(holiday);
    setHolidayEditForm({
      date: toDateKey(holiday.date),
      site_scope: holiday.site_id ? 'site' : 'org',
      site_id: holiday.site_id ?? sites[0]?.id ?? '',
      name: holiday.name,
      holiday_type: holiday.holiday_type,
      is_closed: holiday.is_closed ? 'true' : 'false',
    });
  }

  function startEdit() {
    setDraftShifts(baselineShifts);
    setSelectedShiftKey(null);
    setEditMode(true);
  }

  function changeMonth(nextMonth: Date) {
    setEditMode(false);
    setSelectedShiftKey(null);
    setCurrentMonth(nextMonth);
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      const changed = draftShifts.filter((shift) => {
        const baseline = baselineShiftByKey.get(shift.key);
        if (!baseline) return true;
        return (
          shift.site_id !== baseline.site_id ||
          shift.available !== baseline.available ||
          shift.available_from !== baseline.available_from ||
          shift.available_to !== baseline.available_to ||
          shift.note !== baseline.note
        );
      });

      if (changed.length === 0) return 0;

      const invalidShift = changed.find((shift) => !shift.site_id);
      if (invalidShift) {
        throw new Error('所属店舗が未設定の薬剤師にはシフトを保存できません');
      }

      await Promise.all(
        changed.map(async (shift) => {
          const res = await fetch('/api/pharmacist-shifts', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-org-id': orgId,
            },
            body: JSON.stringify({
              site_id: shift.site_id,
              user_id: shift.user_id,
              date: shift.date,
              available: shift.available,
              available_from: shift.available ? shift.available_from : '',
              available_to: shift.available ? shift.available_to : '',
              note: shift.note || undefined,
            }),
          });
          if (!res.ok) {
            const error = await res.json().catch(() => ({}));
            throw new Error(error.message ?? 'シフト保存に失敗しました');
          }
        }),
      );

      return changed.length;
    },
    onSuccess: async (count) => {
      setEditMode(false);
      setSelectedShiftKey(null);
      if (count > 0) toast.success(`${count}件のシフトを保存しました`);
      await queryClient.invalidateQueries({ queryKey: ['pharmacist-shifts', orgId] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'シフト保存に失敗しました');
    },
  });

  const createHolidayMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/business-holidays', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-org-id': orgId,
        },
        body: JSON.stringify({
          date: holidayForm.date,
          name: holidayForm.name,
          holiday_type: holidayForm.holiday_type,
          is_closed: holidayForm.is_closed === 'true',
          site_id: holidayForm.site_scope === 'site' ? holidayForm.site_id || undefined : undefined,
        }),
      });
      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error(error.message ?? '休日設定の保存に失敗しました');
      }
      return res.json();
    },
    onSuccess: async () => {
      toast.success('休日設定を追加しました');
      setHolidayForm((current) => ({
        ...current,
        name: '',
      }));
      await queryClient.invalidateQueries({ queryKey: ['business-holidays', orgId] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : '休日設定の保存に失敗しました');
    },
  });

  const updateHolidayMutation = useMutation({
    mutationFn: async () => {
      if (!editingHoliday) throw new Error('編集対象の休日が選択されていません');

      const res = await fetch(`/api/business-holidays/${editingHoliday.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'x-org-id': orgId,
        },
        body: JSON.stringify({
          date: holidayEditForm.date,
          name: holidayEditForm.name,
          holiday_type: holidayEditForm.holiday_type,
          is_closed: holidayEditForm.is_closed === 'true',
          site_id:
            holidayEditForm.site_scope === 'site'
              ? holidayEditForm.site_id || undefined
              : undefined,
        }),
      });
      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error(error.message ?? '休日設定の更新に失敗しました');
      }
      return res.json();
    },
    onSuccess: async () => {
      toast.success('休日設定を更新しました');
      setEditingHoliday(null);
      await queryClient.invalidateQueries({ queryKey: ['business-holidays', orgId] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : '休日設定の更新に失敗しました');
    },
  });

  const deleteHolidayMutation = useMutation({
    mutationFn: async (holiday: BusinessHoliday) => {
      const res = await fetch(`/api/business-holidays/${holiday.id}`, {
        method: 'DELETE',
        headers: {
          'x-org-id': orgId,
        },
      });
      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error(error.message ?? '休日設定の削除に失敗しました');
      }
      return holiday;
    },
    onSuccess: async (holiday) => {
      toast.success(`${holiday.name} を削除しました`);
      await queryClient.invalidateQueries({ queryKey: ['business-holidays', orgId] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : '休日設定の削除に失敗しました');
    },
  });

  const createPharmacistMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/pharmacists', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-org-id': orgId,
        },
        body: JSON.stringify({
          ...pharmacistForm,
          phone: pharmacistForm.phone || undefined,
          max_daily_visits: toOptionalNumber(pharmacistForm.max_daily_visits),
          max_weekly_visits: toOptionalNumber(pharmacistForm.max_weekly_visits),
          max_travel_minutes: toOptionalNumber(pharmacistForm.max_travel_minutes),
          visit_specialties: parseListInput(pharmacistForm.visit_specialties),
          coverage_area: parseListInput(pharmacistForm.coverage_area),
        }),
      });
      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error(error.message ?? '薬剤師登録に失敗しました');
      }
      return res.json();
    },
    onSuccess: async () => {
      toast.success('薬剤師を登録しました');
      setPharmacistDialogOpen(false);
      setPharmacistForm({
        name: '',
        name_kana: '',
        email: '',
        phone: '',
        site_id: sites[0]?.id ?? '',
        role: 'pharmacist',
        max_daily_visits: '',
        max_weekly_visits: '',
        max_travel_minutes: '',
        can_accept_emergency: true,
        visit_specialties: '',
        coverage_area: '',
      });
      await queryClient.invalidateQueries({ queryKey: ['pharmacists', orgId] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : '薬剤師登録に失敗しました');
    },
  });

  const updatePharmacistMutation = useMutation({
    mutationFn: async () => {
      if (!editingPharmacistId) throw new Error('編集対象の薬剤師が選択されていません');

      const res = await fetch(`/api/pharmacists/${editingPharmacistId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'x-org-id': orgId,
        },
        body: JSON.stringify({
          action: 'update',
          name: pharmacistForm.name,
          name_kana: pharmacistForm.name_kana,
          phone: pharmacistForm.phone || undefined,
          site_id: pharmacistForm.site_id,
          role: pharmacistForm.role,
          max_daily_visits: toOptionalNumber(pharmacistForm.max_daily_visits),
          max_weekly_visits: toOptionalNumber(pharmacistForm.max_weekly_visits),
          max_travel_minutes: toOptionalNumber(pharmacistForm.max_travel_minutes),
          can_accept_emergency: pharmacistForm.can_accept_emergency,
          visit_specialties: parseListInput(pharmacistForm.visit_specialties),
          coverage_area: parseListInput(pharmacistForm.coverage_area),
        }),
      });
      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error(error.message ?? '薬剤師更新に失敗しました');
      }
      return res.json();
    },
    onSuccess: async () => {
      toast.success('薬剤師情報を更新しました');
      setPharmacistDialogOpen(false);
      setEditingPharmacistId(null);
      await queryClient.invalidateQueries({ queryKey: ['pharmacists', orgId] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : '薬剤師更新に失敗しました');
    },
  });

  const pharmacistActionMutation = useMutation({
    mutationFn: async (target: {
      pharmacist: Pharmacist;
      action: PharmacistAction;
      reason?: string;
    }) => {
      const res = await fetch(`/api/pharmacists/${target.pharmacist.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'x-org-id': orgId,
        },
        body: JSON.stringify(
          target.reason
            ? { action: target.action, reason: target.reason }
            : { action: target.action },
        ),
      });
      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error(error.message ?? '薬剤師状態の更新に失敗しました');
      }
      return target;
    },
    onSuccess: async (target) => {
      const message =
        target.action === 'resend_invite'
          ? '招待を再送しました'
          : target.action === 'reactivate'
            ? '薬剤師を再開しました'
            : target.action === 'retire'
              ? '薬剤師を退職処理しました'
              : '薬剤師を停止しました';
      toast.success(message);
      setPharmacistActionTarget(null);
      setPharmacistActionReason('');
      await queryClient.invalidateQueries({ queryKey: ['pharmacists', orgId] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : '薬剤師状態の更新に失敗しました');
    },
  });

  const copyPreviousMonthMutation = useMutation({
    mutationFn: async () => {
      const sourceMonth = subMonths(currentMonth, 1);
      const res = await fetch(
        `/api/pharmacist-shifts?month=${format(sourceMonth, 'yyyy-MM-01')}&limit=400`,
        {
          headers: { 'x-org-id': orgId },
        },
      );
      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error(error.message ?? '前月シフトの取得に失敗しました');
      }
      return res.json() as Promise<{ data: ShiftRecord[] }>;
    },
    onSuccess: (payload) => {
      const sourceShiftByUserAndDay = new Map(
        payload.data.map((shift) => [`${shift.user_id}:${parseISO(shift.date).getDate()}`, shift]),
      );

      const copied = baselineShifts.map((shift) => {
        const source = sourceShiftByUserAndDay.get(
          `${shift.user_id}:${parseISO(shift.date).getDate()}`,
        );
        if (!source) return shift;

        return {
          ...shift,
          site_id: source.site_id,
          site_name: source.site?.name ?? shift.site_name,
          available: source.available,
          available_from: toTimeValue(source.available_from) || '09:00',
          available_to: toTimeValue(source.available_to) || '18:00',
          note: source.note ?? '',
        };
      });

      setDraftShifts(copied);
      setSelectedShiftKey(null);
      setEditMode(true);
      toast.success('前月の同日シフトを下書きへコピーしました');
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : '前月コピーに失敗しました');
    },
  });

  const upsertTemplateMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/pharmacist-shift-templates', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-org-id': orgId,
        },
        body: JSON.stringify({
          user_id: templateForm.user_id,
          site_id: templateForm.site_id,
          weekday: Number(templateForm.weekday),
          available: templateForm.available,
          available_from: templateForm.available ? templateForm.available_from : undefined,
          available_to: templateForm.available ? templateForm.available_to : undefined,
          note: templateForm.note || undefined,
        }),
      });
      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error(error.message ?? '定型シフトの保存に失敗しました');
      }
      return res.json();
    },
    onSuccess: async () => {
      toast.success(editingTemplateId ? '定型シフトを更新しました' : '定型シフトを登録しました');
      resetTemplateForm();
      await queryClient.invalidateQueries({ queryKey: ['pharmacist-shift-templates', orgId] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : '定型シフトの保存に失敗しました');
    },
  });

  const deleteTemplateMutation = useMutation({
    mutationFn: async (template: ShiftTemplate) => {
      const res = await fetch(`/api/pharmacist-shift-templates/${template.id}`, {
        method: 'DELETE',
        headers: {
          'x-org-id': orgId,
        },
      });
      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error(error.message ?? '定型シフトの削除に失敗しました');
      }
      return template;
    },
    onSuccess: async (template) => {
      toast.success(
        `${template.user.name}の${weekdayLabel(template.weekday)}テンプレートを削除しました`,
      );
      if (editingTemplateId === template.id) resetTemplateForm();
      await queryClient.invalidateQueries({ queryKey: ['pharmacist-shift-templates', orgId] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : '定型シフトの削除に失敗しました');
    },
  });

  const applyTemplateMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/pharmacist-shift-templates/apply', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-org-id': orgId,
        },
        body: JSON.stringify({
          month: templateApplyMonth,
          user_id: templateApplyUserId === 'all' ? undefined : templateApplyUserId,
        }),
      });
      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error(error.message ?? '定型シフトの反映に失敗しました');
      }
      return res.json() as Promise<{ data: { applied_count: number } }>;
    },
    onSuccess: async (payload) => {
      toast.success(`${payload.data.applied_count}件のシフトを反映しました`);
      await queryClient.invalidateQueries({ queryKey: ['pharmacist-shifts', orgId] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : '定型シフトの反映に失敗しました');
    },
  });

  return (
    <div className="space-y-6">
      <Card className="overflow-hidden border-none bg-[linear-gradient(135deg,rgba(245,248,255,1),rgba(248,250,252,1))] ring-1 ring-slate-200">
        <CardContent className="flex flex-col gap-5 px-5 py-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
              Pharmacist Operations
            </p>
            <h2 className="mt-2 text-xl font-semibold text-slate-900">
              担当薬剤師制を前提にしたシフトと休日管理
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
              月間シフト、所属店舗、休日・祝日を管理します。訪問候補生成ではこの
              シフトと休日情報を参照し、担当薬剤師で対応できない場合のみ代替割当を行います。
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={openPharmacistDialog} disabled={sites.length === 0}>
              <UserPlus className="mr-1.5 size-4" />
              薬剤師登録
            </Button>
            {editMode ? (
              <>
                <Button
                  variant="outline"
                  onClick={() => copyPreviousMonthMutation.mutate()}
                  disabled={copyPreviousMonthMutation.isPending}
                >
                  {copyPreviousMonthMutation.isPending ? '読込中...' : '前月をコピー'}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setEditMode(false);
                    setSelectedShiftKey(null);
                  }}
                  disabled={saveMutation.isPending}
                >
                  キャンセル
                </Button>
                <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
                  {saveMutation.isPending ? '保存中...' : 'シフト保存'}
                </Button>
              </>
            ) : (
              <>
                <Button
                  variant="outline"
                  onClick={() => copyPreviousMonthMutation.mutate()}
                  disabled={pharmacists.length === 0 || copyPreviousMonthMutation.isPending}
                >
                  {copyPreviousMonthMutation.isPending ? '読込中...' : '前月をコピー'}
                </Button>
                <Button onClick={startEdit} disabled={pharmacists.length === 0}>
                  シフト編集
                </Button>
              </>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-3 md:grid-cols-3">
        <Card size="sm">
          <CardContent>
            <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">薬剤師</p>
            <p className="mt-2 text-2xl font-semibold text-foreground">{pharmacists.length}</p>
            <p className="mt-1 text-xs text-muted-foreground">担当薬剤師候補</p>
          </CardContent>
        </Card>
        <Card size="sm">
          <CardContent>
            <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">休日設定</p>
            <p className="mt-2 text-2xl font-semibold text-foreground">{holidays.length}</p>
            <p className="mt-1 text-xs text-muted-foreground">当月の祝日・休業日</p>
          </CardContent>
        </Card>
        <Card size="sm">
          <CardContent>
            <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">編集状態</p>
            <p className="mt-2 text-2xl font-semibold text-foreground">
              {editMode ? '編集中' : '参照'}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {editMode
                ? 'セル選択で時間と店舗を更新できます'
                : '編集を開始すると月間シフトを更新できます'}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-4 border-b lg:flex-row lg:items-end lg:justify-between">
          <div>
            <CardTitle className="text-base">月間シフトカレンダー</CardTitle>
            <CardDescription>休日適用日は赤背景で表示されます</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="icon"
              variant="outline"
              onClick={() => changeMonth(subMonths(currentMonth, 1))}
              aria-label="前月"
            >
              <ChevronLeft className="size-4" />
            </Button>
            <div className="min-w-[120px] text-center text-base font-semibold">{monthLabel}</div>
            <Button
              size="icon"
              variant="outline"
              onClick={() => changeMonth(addMonths(currentMonth, 1))}
              aria-label="翌月"
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {pharmacistsLoading || shiftsLoading ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              シフトを読み込んでいます...
            </div>
          ) : pharmacists.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              薬剤師が登録されていません
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="min-w-full border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-border bg-muted/60">
                      <th className="sticky left-0 z-10 min-w-[160px] bg-muted/60 px-3 py-2 text-left font-medium text-muted-foreground">
                        薬剤師
                      </th>
                      {days.map((day) => {
                        const dateKey = format(day, 'yyyy-MM-dd');
                        const dayHolidays = holidaysByDate.get(dateKey) ?? [];
                        const isHoliday = dayHolidays.some((holiday) => holiday.site_id == null);
                        const dow = getDay(day);

                        return (
                          <th
                            key={dateKey}
                            className={[
                              'min-w-[48px] px-1.5 py-2 text-center font-medium',
                              dow === 0
                                ? 'text-rose-600'
                                : dow === 6
                                  ? 'text-sky-600'
                                  : 'text-muted-foreground',
                              isHoliday ? 'bg-rose-50/80' : '',
                            ].join(' ')}
                          >
                            <div>{format(day, 'd')}</div>
                            <div className="text-[10px] font-normal">
                              {format(day, 'E', { locale: ja })}
                            </div>
                            {dayHolidays.length > 0 && (
                              <div className="mt-1 text-[9px] text-rose-600">休</div>
                            )}
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {pharmacists.map((pharmacist) => (
                      <tr key={pharmacist.id} className="border-b border-border hover:bg-muted/20">
                        <td className="sticky left-0 z-10 bg-background px-3 py-2">
                          <div className="font-medium text-foreground">{pharmacist.name}</div>
                          <div className="text-[11px] text-muted-foreground">
                            {pharmacist.site_name ?? '所属店舗未設定'}
                          </div>
                        </td>
                        {days.map((day) => {
                          const date = format(day, 'yyyy-MM-dd');
                          const shift = visibleShiftByKey.get(cellKey(pharmacist.id, date));
                          if (!shift) return null;

                          const matchingHolidays = (holidaysByDate.get(date) ?? []).filter(
                            (holiday) => holidayAppliesToSite(holiday, shift.site_id),
                          );
                          const isHoliday = matchingHolidays.length > 0;
                          const isSelected = selectedShiftKey === shift.key;

                          return (
                            <td
                              key={shift.key}
                              className={[
                                'px-1.5 py-2 text-center',
                                editMode ? 'cursor-pointer hover:bg-muted/50' : '',
                                isHoliday ? 'bg-rose-50/70' : '',
                                isSelected ? 'ring-2 ring-inset ring-primary' : '',
                              ].join(' ')}
                              onClick={() => editMode && setSelectedShiftKey(shift.key)}
                            >
                              {isHoliday ? (
                                <div className="space-y-0.5">
                                  <div className="text-[10px] font-medium text-rose-700">休</div>
                                  <div className="text-[9px] text-rose-600">
                                    {matchingHolidays[0]?.site?.name ?? '全体'}
                                  </div>
                                </div>
                              ) : shift.available ? (
                                <div className="flex flex-col items-center gap-0.5">
                                  <Check className="size-3.5 text-emerald-600" />
                                  <span className="text-[9px] text-muted-foreground">
                                    {shift.available_from}
                                  </span>
                                </div>
                              ) : (
                                <X className="mx-auto size-3.5 text-slate-300" />
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {editMode && selectedShift && (
                <Card className="border-dashed">
                  <CardHeader>
                    <CardTitle className="text-base">
                      {selectedShift.user_name} /{' '}
                      {format(parseISO(selectedShift.date), 'yyyy年M月d日(E)', { locale: ja })}
                    </CardTitle>
                    <CardDescription>出勤可否、店舗、時間帯、備考を編集します</CardDescription>
                  </CardHeader>
                  <CardContent className="grid gap-4 lg:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="shift-status">勤務状態</Label>
                      <Select
                        value={selectedShift.available ? 'available' : 'unavailable'}
                        onValueChange={(value) =>
                          updateDraftShift(selectedShift.key, (shift) => ({
                            ...shift,
                            available: value === 'available',
                          }))
                        }
                      >
                        <SelectTrigger id="shift-status" className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="available">出勤可</SelectItem>
                          <SelectItem value="unavailable">出勤不可</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="shift-site">所属店舗</Label>
                      <Select
                        value={selectedShift.site_id}
                        onValueChange={(value) =>
                          value
                            ? updateDraftShift(selectedShift.key, (shift) => ({
                                ...shift,
                                site_id: value,
                                site_name: siteById.get(value)?.name ?? null,
                              }))
                            : undefined
                        }
                      >
                        <SelectTrigger id="shift-site" className="w-full">
                          <SelectValue placeholder="店舗を選択" />
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
                    <div className="space-y-1.5">
                      <Label htmlFor="shift-from">開始時刻</Label>
                      <Input
                        id="shift-from"
                        type="time"
                        value={selectedShift.available_from}
                        onChange={(event) =>
                          updateDraftShift(selectedShift.key, (shift) => ({
                            ...shift,
                            available_from: event.target.value,
                          }))
                        }
                        disabled={!selectedShift.available}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="shift-to">終了時刻</Label>
                      <Input
                        id="shift-to"
                        type="time"
                        value={selectedShift.available_to}
                        onChange={(event) =>
                          updateDraftShift(selectedShift.key, (shift) => ({
                            ...shift,
                            available_to: event.target.value,
                          }))
                        }
                        disabled={!selectedShift.available}
                      />
                    </div>
                    <div className="space-y-1.5 lg:col-span-2">
                      <Label htmlFor="shift-note">備考</Label>
                      <Textarea
                        id="shift-note"
                        rows={3}
                        value={selectedShift.note}
                        onChange={(event) =>
                          updateDraftShift(selectedShift.key, (shift) => ({
                            ...shift,
                            note: event.target.value,
                          }))
                        }
                        placeholder="例: 午後は在宅急変対応のため外出優先"
                      />
                    </div>
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">薬剤師一覧</CardTitle>
            <CardDescription>担当薬剤師制の割当候補として利用されます</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {pharmacists.length === 0 ? (
              <p className="text-sm text-muted-foreground">薬剤師が登録されていません</p>
            ) : (
              pharmacists.map((pharmacist) => (
                <div key={pharmacist.id} className="space-y-3 rounded-xl border px-3 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium text-foreground">{pharmacist.name}</p>
                        <Badge
                          variant="outline"
                          className={pharmacistStatusClass(pharmacist.account_status)}
                        >
                          {pharmacistStatusLabel(pharmacist.account_status)}
                        </Badge>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {pharmacist.site_name ?? '所属店舗未設定'} / {pharmacist.role}
                      </p>
                      <p className="mt-2 text-xs text-muted-foreground">
                        {formatCapacitySummary(pharmacist)}
                      </p>
                    </div>
                    <div className="text-right text-xs text-muted-foreground">
                      <p>{pharmacist.email}</p>
                      <p>{pharmacist.phone ?? '電話番号未設定'}</p>
                    </div>
                  </div>

                  <div className="grid gap-1 text-xs text-muted-foreground md:grid-cols-2">
                    <p>
                      招待日時:{' '}
                      {pharmacist.invited_at
                        ? format(parseISO(pharmacist.invited_at), 'yyyy/MM/dd HH:mm', {
                            locale: ja,
                          })
                        : '未送信'}
                    </p>
                    <p>
                      稼働開始:{' '}
                      {pharmacist.activated_at
                        ? format(parseISO(pharmacist.activated_at), 'yyyy/MM/dd HH:mm', {
                            locale: ja,
                          })
                        : '未ログイン'}
                    </p>
                    {pharmacist.deactivation_reason && (
                      <p className="md:col-span-2">停止理由: {pharmacist.deactivation_reason}</p>
                    )}
                  </div>

                  {pharmacist.visit_specialties?.length || pharmacist.coverage_area?.length ? (
                    <div className="flex flex-wrap gap-2">
                      {pharmacist.visit_specialties?.map((specialty) => (
                        <Badge key={`${pharmacist.id}-specialty-${specialty}`} variant="outline">
                          専門: {specialty}
                        </Badge>
                      ))}
                      {pharmacist.coverage_area?.map((area) => (
                        <Badge key={`${pharmacist.id}-area-${area}`} variant="outline">
                          対応圏: {area}
                        </Badge>
                      ))}
                    </div>
                  ) : null}

                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => openPharmacistEditDialog(pharmacist)}
                    >
                      編集
                    </Button>
                    {pharmacist.account_status === 'invited' && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          setPharmacistActionTarget({
                            pharmacist,
                            action: 'resend_invite',
                          })
                        }
                      >
                        招待再送
                      </Button>
                    )}
                    {pharmacist.account_status === 'suspended' ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          setPharmacistActionTarget({
                            pharmacist,
                            action: 'reactivate',
                          })
                        }
                      >
                        再開
                      </Button>
                    ) : pharmacist.account_status !== 'retired' ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          setPharmacistActionTarget({
                            pharmacist,
                            action: 'suspend',
                          })
                        }
                      >
                        停止
                      </Button>
                    ) : null}
                    {pharmacist.account_status !== 'retired' && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          setPharmacistActionTarget({
                            pharmacist,
                            action: 'retire',
                          })
                        }
                      >
                        退職
                      </Button>
                    )}
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">週次定型シフト</CardTitle>
              <CardDescription>
                薬剤師ごとの曜日テンプレートを登録し、対象月へ一括反映します
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="template-user">薬剤師</Label>
                  <Select
                    value={templateForm.user_id}
                    onValueChange={(value) =>
                      value
                        ? setTemplateForm((current) => ({
                            ...current,
                            user_id: value,
                          }))
                        : undefined
                    }
                  >
                    <SelectTrigger id="template-user" className="w-full">
                      <SelectValue placeholder="薬剤師を選択" />
                    </SelectTrigger>
                    <SelectContent>
                      {pharmacists.map((pharmacist) => (
                        <SelectItem key={pharmacist.id} value={pharmacist.id}>
                          {pharmacist.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="template-site">店舗</Label>
                  <Select
                    value={templateForm.site_id}
                    onValueChange={(value) =>
                      value
                        ? setTemplateForm((current) => ({
                            ...current,
                            site_id: value,
                          }))
                        : undefined
                    }
                  >
                    <SelectTrigger id="template-site" className="w-full">
                      <SelectValue placeholder="店舗を選択" />
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

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="template-weekday">曜日</Label>
                  <Select
                    value={templateForm.weekday}
                    onValueChange={(value) =>
                      value
                        ? setTemplateForm((current) => ({
                            ...current,
                            weekday: value,
                          }))
                        : undefined
                    }
                  >
                    <SelectTrigger id="template-weekday" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {WEEKDAY_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center gap-3 rounded-lg border px-3 py-2">
                  <Checkbox
                    id="template-available"
                    checked={templateForm.available}
                    onCheckedChange={(checked) =>
                      setTemplateForm((current) => ({
                        ...current,
                        available: checked === true,
                      }))
                    }
                  />
                  <label htmlFor="template-available" className="cursor-pointer text-sm">
                    この曜日を勤務可として扱う
                  </label>
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="template-from">開始時刻</Label>
                  <Input
                    id="template-from"
                    type="time"
                    value={templateForm.available_from}
                    onChange={(event) =>
                      setTemplateForm((current) => ({
                        ...current,
                        available_from: event.target.value,
                      }))
                    }
                    disabled={!templateForm.available}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="template-to">終了時刻</Label>
                  <Input
                    id="template-to"
                    type="time"
                    value={templateForm.available_to}
                    onChange={(event) =>
                      setTemplateForm((current) => ({
                        ...current,
                        available_to: event.target.value,
                      }))
                    }
                    disabled={!templateForm.available}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="template-note">備考</Label>
                <Textarea
                  id="template-note"
                  rows={2}
                  value={templateForm.note}
                  onChange={(event) =>
                    setTemplateForm((current) => ({
                      ...current,
                      note: event.target.value,
                    }))
                  }
                  placeholder="例: 午前は施設対応、午後は在宅訪問優先"
                />
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  onClick={() => upsertTemplateMutation.mutate()}
                  disabled={
                    !templateForm.user_id ||
                    !templateForm.site_id ||
                    upsertTemplateMutation.isPending
                  }
                >
                  {upsertTemplateMutation.isPending
                    ? '保存中...'
                    : editingTemplateId
                      ? '定型シフトを更新'
                      : '定型シフトを登録'}
                </Button>
                {editingTemplateId ? (
                  <Button variant="outline" onClick={resetTemplateForm}>
                    編集を解除
                  </Button>
                ) : null}
              </div>

              <div className="space-y-3 border-t pt-4">
                <div className="grid gap-4 md:grid-cols-[1fr_1fr_auto]">
                  <div className="space-y-1.5">
                    <Label htmlFor="template-apply-month">反映対象月</Label>
                    <Input
                      id="template-apply-month"
                      type="month"
                      value={templateApplyMonth}
                      onChange={(event) => setTemplateApplyMonth(event.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="template-apply-user">反映対象</Label>
                    <Select
                      value={templateApplyUserId}
                      onValueChange={(value) => value && setTemplateApplyUserId(value)}
                    >
                      <SelectTrigger id="template-apply-user" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">全薬剤師</SelectItem>
                        {pharmacists.map((pharmacist) => (
                          <SelectItem key={pharmacist.id} value={pharmacist.id}>
                            {pharmacist.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-end">
                    <Button
                      className="w-full"
                      onClick={() => applyTemplateMutation.mutate()}
                      disabled={!templateApplyMonth || applyTemplateMutation.isPending}
                    >
                      {applyTemplateMutation.isPending ? '反映中...' : '対象月へ反映'}
                    </Button>
                  </div>
                </div>

                {templates.length === 0 ? (
                  <p className="text-sm text-muted-foreground">登録済みの定型シフトはありません</p>
                ) : (
                  templates.map((template) => (
                    <div key={template.id} className="rounded-xl border px-3 py-3 text-sm">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="font-medium text-foreground">
                            {template.user.name} / {weekdayLabel(template.weekday)}
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {template.site?.name ?? '店舗未設定'} /{' '}
                            {template.available
                              ? `${toTimeValue(template.available_from) || '--:--'} - ${toTimeValue(template.available_to) || '--:--'}`
                              : '勤務不可'}
                          </p>
                          {template.note ? (
                            <p className="mt-1 text-xs text-muted-foreground">{template.note}</p>
                          ) : null}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => loadTemplateIntoForm(template)}
                          >
                            編集
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => deleteTemplateMutation.mutate(template)}
                            disabled={deleteTemplateMutation.isPending}
                          >
                            削除
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">休日・祝日設定</CardTitle>
              <CardDescription>組織全体または店舗単位の休業日を登録します</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="holiday-date">日付</Label>
                  <Input
                    id="holiday-date"
                    type="date"
                    value={holidayForm.date}
                    onChange={(event) =>
                      setHolidayForm((current) => ({
                        ...current,
                        date: event.target.value,
                      }))
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="holiday-type">種別</Label>
                  <Select
                    value={holidayForm.holiday_type}
                    onValueChange={(value) =>
                      value
                        ? setHolidayForm((current) => ({
                            ...current,
                            holiday_type: value as BusinessHoliday['holiday_type'],
                          }))
                        : undefined
                    }
                  >
                    <SelectTrigger id="holiday-type" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="public_holiday">祝日</SelectItem>
                      <SelectItem value="site_closure">店舗休業</SelectItem>
                      <SelectItem value="org_event">組織行事</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="holiday-scope">適用範囲</Label>
                  <Select
                    value={holidayForm.site_scope}
                    onValueChange={(value) =>
                      value
                        ? setHolidayForm((current) => ({
                            ...current,
                            site_scope: value,
                          }))
                        : undefined
                    }
                  >
                    <SelectTrigger id="holiday-scope" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="org">組織全体</SelectItem>
                      <SelectItem value="site">店舗単位</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="holiday-site">店舗</Label>
                  <Select
                    value={
                      holidayForm.site_scope === 'site' ? holidayForm.site_id : (sites[0]?.id ?? '')
                    }
                    onValueChange={(value) =>
                      value
                        ? setHolidayForm((current) => ({
                            ...current,
                            site_id: value,
                          }))
                        : undefined
                    }
                    disabled={holidayForm.site_scope !== 'site'}
                  >
                    <SelectTrigger id="holiday-site" className="w-full">
                      <SelectValue placeholder="店舗を選択" />
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

              <div className="space-y-1.5">
                <Label htmlFor="holiday-name">休日名</Label>
                <Input
                  id="holiday-name"
                  value={holidayForm.name}
                  onChange={(event) =>
                    setHolidayForm((current) => ({
                      ...current,
                      name: event.target.value,
                    }))
                  }
                  placeholder="例: 建国記念の日 / 本店棚卸休業"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="holiday-closed">営業状態</Label>
                <Select
                  value={holidayForm.is_closed}
                  onValueChange={(value) =>
                    value
                      ? setHolidayForm((current) => ({
                          ...current,
                          is_closed: value,
                        }))
                      : undefined
                  }
                >
                  <SelectTrigger id="holiday-closed" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="true">休業扱い</SelectItem>
                    <SelectItem value="false">メモのみ</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <Button
                className="w-full"
                onClick={() => createHolidayMutation.mutate()}
                disabled={
                  !holidayForm.date ||
                  !holidayForm.name ||
                  (holidayForm.site_scope === 'site' && !holidayForm.site_id) ||
                  createHolidayMutation.isPending
                }
              >
                <CalendarPlus2 className="mr-1.5 size-4" />
                {createHolidayMutation.isPending ? '登録中...' : '休日を追加'}
              </Button>

              <div className="space-y-2 border-t pt-4">
                {holidays.length === 0 ? (
                  <p className="text-sm text-muted-foreground">当月の休日設定はありません</p>
                ) : (
                  holidays.map((holiday) => (
                    <div key={holiday.id} className="rounded-xl border px-3 py-3 text-sm">
                      <div className="flex items-center justify-between gap-3">
                        <p className="font-medium text-foreground">{holiday.name}</p>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground">
                            {format(parseISO(holiday.date), 'M/d(E)', { locale: ja })}
                          </span>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => openHolidayEditDialog(holiday)}
                          >
                            編集
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => deleteHolidayMutation.mutate(holiday)}
                            disabled={deleteHolidayMutation.isPending}
                          >
                            削除
                          </Button>
                        </div>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {holiday.site?.name ?? '組織全体'} / {holiday.holiday_type} /{' '}
                        {holiday.is_closed ? '休業' : '注意喚起'}
                      </p>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <Dialog open={pharmacistDialogOpen} onOpenChange={setPharmacistDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {pharmacistDialogMode === 'create' ? '薬剤師登録' : '薬剤師情報を編集'}
            </DialogTitle>
            <DialogDescription>
              {pharmacistDialogMode === 'create'
                ? '新しい担当薬剤師を登録し、シフト管理とケース割当に利用します。'
                : '所属店舗、役割、連絡先を更新します。'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="pharmacist-name">氏名</Label>
                <Input
                  id="pharmacist-name"
                  value={pharmacistForm.name}
                  onChange={(event) =>
                    setPharmacistForm((current) => ({
                      ...current,
                      name: event.target.value,
                    }))
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pharmacist-name-kana">フリガナ</Label>
                <Input
                  id="pharmacist-name-kana"
                  value={pharmacistForm.name_kana}
                  onChange={(event) =>
                    setPharmacistForm((current) => ({
                      ...current,
                      name_kana: event.target.value,
                    }))
                  }
                />
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="pharmacist-email">メールアドレス</Label>
                <Input
                  id="pharmacist-email"
                  type="email"
                  value={pharmacistForm.email}
                  onChange={(event) =>
                    setPharmacistForm((current) => ({
                      ...current,
                      email: event.target.value,
                    }))
                  }
                  disabled={pharmacistDialogMode === 'edit'}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pharmacist-phone">電話番号</Label>
                <Input
                  id="pharmacist-phone"
                  value={pharmacistForm.phone}
                  onChange={(event) =>
                    setPharmacistForm((current) => ({
                      ...current,
                      phone: event.target.value,
                    }))
                  }
                />
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="pharmacist-site">所属店舗</Label>
                <Select
                  value={pharmacistForm.site_id}
                  onValueChange={(value) =>
                    value
                      ? setPharmacistForm((current) => ({
                          ...current,
                          site_id: value,
                        }))
                      : undefined
                  }
                >
                  <SelectTrigger id="pharmacist-site" className="w-full">
                    <SelectValue placeholder="店舗を選択" />
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
              <div className="space-y-1.5">
                <Label htmlFor="pharmacist-role">役割</Label>
                <Select
                  value={pharmacistForm.role}
                  onValueChange={(value) =>
                    value
                      ? setPharmacistForm((current) => ({
                          ...current,
                          role: value as 'pharmacist' | 'pharmacist_trainee' | 'admin',
                        }))
                      : undefined
                  }
                >
                  <SelectTrigger id="pharmacist-role" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pharmacist">薬剤師</SelectItem>
                    <SelectItem value="pharmacist_trainee">研修薬剤師</SelectItem>
                    {pharmacistDialogMode === 'edit' ? (
                      <SelectItem value="admin">管理者</SelectItem>
                    ) : null}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="pharmacist-max-daily">日次上限件数</Label>
                <Input
                  id="pharmacist-max-daily"
                  type="number"
                  min="1"
                  max="20"
                  value={pharmacistForm.max_daily_visits}
                  onChange={(event) =>
                    setPharmacistForm((current) => ({
                      ...current,
                      max_daily_visits: event.target.value,
                    }))
                  }
                  placeholder="例: 6"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pharmacist-max-weekly">週次上限件数</Label>
                <Input
                  id="pharmacist-max-weekly"
                  type="number"
                  min="1"
                  max="100"
                  value={pharmacistForm.max_weekly_visits}
                  onChange={(event) =>
                    setPharmacistForm((current) => ({
                      ...current,
                      max_weekly_visits: event.target.value,
                    }))
                  }
                  placeholder="例: 25"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pharmacist-max-travel">移動上限分</Label>
                <Input
                  id="pharmacist-max-travel"
                  type="number"
                  min="0"
                  max="480"
                  value={pharmacistForm.max_travel_minutes}
                  onChange={(event) =>
                    setPharmacistForm((current) => ({
                      ...current,
                      max_travel_minutes: event.target.value,
                    }))
                  }
                  placeholder="例: 90"
                />
              </div>
            </div>

            <div className="flex items-center gap-3 rounded-lg border px-3 py-2">
              <Checkbox
                id="pharmacist-emergency"
                checked={pharmacistForm.can_accept_emergency}
                onCheckedChange={(checked) =>
                  setPharmacistForm((current) => ({
                    ...current,
                    can_accept_emergency: checked === true,
                  }))
                }
              />
              <label htmlFor="pharmacist-emergency" className="cursor-pointer text-sm">
                緊急訪問の割込候補に含める
              </label>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="pharmacist-specialties">対応領域</Label>
                <Textarea
                  id="pharmacist-specialties"
                  rows={4}
                  value={pharmacistForm.visit_specialties}
                  onChange={(event) =>
                    setPharmacistForm((current) => ({
                      ...current,
                      visit_specialties: event.target.value,
                    }))
                  }
                  placeholder={'例:\n在宅緩和\n施設\n無菌調剤'}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pharmacist-coverage">対応エリア</Label>
                <Textarea
                  id="pharmacist-coverage"
                  rows={4}
                  value={pharmacistForm.coverage_area}
                  onChange={(event) =>
                    setPharmacistForm((current) => ({
                      ...current,
                      coverage_area: event.target.value,
                    }))
                  }
                  placeholder={'例:\n世田谷区\n目黒区\n川崎市中原区'}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setPharmacistDialogOpen(false)}
              disabled={createPharmacistMutation.isPending || updatePharmacistMutation.isPending}
            >
              閉じる
            </Button>
            <Button
              onClick={() =>
                pharmacistDialogMode === 'create'
                  ? createPharmacistMutation.mutate()
                  : updatePharmacistMutation.mutate()
              }
              disabled={
                !pharmacistForm.name ||
                !pharmacistForm.name_kana ||
                !pharmacistForm.email ||
                !pharmacistForm.site_id ||
                createPharmacistMutation.isPending ||
                updatePharmacistMutation.isPending
              }
            >
              {createPharmacistMutation.isPending || updatePharmacistMutation.isPending
                ? '保存中...'
                : pharmacistDialogMode === 'create'
                  ? '登録する'
                  : '更新する'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={editingHoliday !== null}
        onOpenChange={(open) => !open && setEditingHoliday(null)}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>休日設定を編集</DialogTitle>
            <DialogDescription>休業日名、適用範囲、営業状態を更新します。</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="holiday-edit-date">日付</Label>
                <Input
                  id="holiday-edit-date"
                  type="date"
                  value={holidayEditForm.date}
                  onChange={(event) =>
                    setHolidayEditForm((current) => ({
                      ...current,
                      date: event.target.value,
                    }))
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="holiday-edit-type">種別</Label>
                <Select
                  value={holidayEditForm.holiday_type}
                  onValueChange={(value) =>
                    value
                      ? setHolidayEditForm((current) => ({
                          ...current,
                          holiday_type: value as BusinessHoliday['holiday_type'],
                        }))
                      : undefined
                  }
                >
                  <SelectTrigger id="holiday-edit-type" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="public_holiday">祝日</SelectItem>
                    <SelectItem value="site_closure">店舗休業</SelectItem>
                    <SelectItem value="org_event">組織行事</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="holiday-edit-scope">適用範囲</Label>
                <Select
                  value={holidayEditForm.site_scope}
                  onValueChange={(value) =>
                    value
                      ? setHolidayEditForm((current) => ({
                          ...current,
                          site_scope: value,
                        }))
                      : undefined
                  }
                >
                  <SelectTrigger id="holiday-edit-scope" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="org">組織全体</SelectItem>
                    <SelectItem value="site">店舗単位</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="holiday-edit-site">店舗</Label>
                <Select
                  value={
                    holidayEditForm.site_scope === 'site'
                      ? holidayEditForm.site_id
                      : (sites[0]?.id ?? '')
                  }
                  onValueChange={(value) =>
                    value
                      ? setHolidayEditForm((current) => ({
                          ...current,
                          site_id: value,
                        }))
                      : undefined
                  }
                  disabled={holidayEditForm.site_scope !== 'site'}
                >
                  <SelectTrigger id="holiday-edit-site" className="w-full">
                    <SelectValue placeholder="店舗を選択" />
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

            <div className="space-y-1.5">
              <Label htmlFor="holiday-edit-name">休日名</Label>
              <Input
                id="holiday-edit-name"
                value={holidayEditForm.name}
                onChange={(event) =>
                  setHolidayEditForm((current) => ({
                    ...current,
                    name: event.target.value,
                  }))
                }
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="holiday-edit-closed">営業状態</Label>
              <Select
                value={holidayEditForm.is_closed}
                onValueChange={(value) =>
                  value
                    ? setHolidayEditForm((current) => ({
                        ...current,
                        is_closed: value,
                      }))
                    : undefined
                }
              >
                <SelectTrigger id="holiday-edit-closed" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="true">休業扱い</SelectItem>
                  <SelectItem value="false">メモのみ</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setEditingHoliday(null)}
              disabled={updateHolidayMutation.isPending}
            >
              閉じる
            </Button>
            <Button
              onClick={() => updateHolidayMutation.mutate()}
              disabled={
                !holidayEditForm.date ||
                !holidayEditForm.name ||
                (holidayEditForm.site_scope === 'site' && !holidayEditForm.site_id) ||
                updateHolidayMutation.isPending
              }
            >
              {updateHolidayMutation.isPending ? '保存中...' : '更新する'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={pharmacistActionTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPharmacistActionTarget(null);
            setPharmacistActionReason('');
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {pharmacistActionTarget?.action === 'resend_invite'
                ? '招待メールを再送'
                : pharmacistActionTarget?.action === 'reactivate'
                  ? '薬剤師を再開'
                  : pharmacistActionTarget?.action === 'retire'
                    ? '薬剤師を退職処理'
                    : '薬剤師を停止'}
            </DialogTitle>
            <DialogDescription>
              {pharmacistActionTarget?.pharmacist.name ?? ''} の状態を更新します。
            </DialogDescription>
          </DialogHeader>
          {(pharmacistActionTarget?.action === 'suspend' ||
            pharmacistActionTarget?.action === 'retire') && (
            <div className="space-y-1.5">
              <Label htmlFor="pharmacist-action-reason">理由</Label>
              <Textarea
                id="pharmacist-action-reason"
                rows={4}
                value={pharmacistActionReason}
                onChange={(event) => setPharmacistActionReason(event.target.value)}
                placeholder={
                  pharmacistActionTarget?.action === 'retire'
                    ? '例: 2026年4月末で退職'
                    : '例: 長期休職のため一時停止'
                }
              />
            </div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setPharmacistActionTarget(null);
                setPharmacistActionReason('');
              }}
              disabled={pharmacistActionMutation.isPending}
            >
              閉じる
            </Button>
            <Button
              onClick={() => {
                if (!pharmacistActionTarget) return;
                pharmacistActionMutation.mutate({
                  pharmacist: pharmacistActionTarget.pharmacist,
                  action: pharmacistActionTarget.action,
                  reason:
                    pharmacistActionTarget.action === 'suspend' ||
                    pharmacistActionTarget.action === 'retire'
                      ? pharmacistActionReason
                      : undefined,
                });
              }}
              disabled={
                pharmacistActionMutation.isPending ||
                ((pharmacistActionTarget?.action === 'suspend' ||
                  pharmacistActionTarget?.action === 'retire') &&
                  !pharmacistActionReason)
              }
            >
              {pharmacistActionMutation.isPending ? '処理中...' : '実行する'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
