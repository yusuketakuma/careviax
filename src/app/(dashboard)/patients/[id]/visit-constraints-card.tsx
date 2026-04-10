'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { getPatientCareQueryKeys, invalidateQueryKeys } from '@/lib/visits/query-invalidations';

type VisitConstraintsResponse = {
  data: {
    scheduling_preference: {
      preferred_weekdays: number[] | null;
      preferred_time_from: string | null;
      preferred_time_to: string | null;
      phone_contact_from: string | null;
      phone_contact_to: string | null;
      facility_time_from: string | null;
      facility_time_to: string | null;
      family_presence_required: boolean;
      visit_buffer_minutes: number | null;
      preferred_contact_name: string | null;
      preferred_contact_phone: string | null;
      notes: string | null;
    } | null;
    residence: {
      lat: number | null;
      lng: number | null;
      geocode_status: string | null;
      geocode_source: string | null;
      geocode_accuracy: string | null;
      geocoded_at: string | null;
    } | null;
  };
};

type VisitConstraintsFormState = {
  preferred_weekdays: number[];
  preferred_time_from: string;
  preferred_time_to: string;
  phone_contact_from: string;
  phone_contact_to: string;
  facility_time_from: string;
  facility_time_to: string;
  family_presence_required: boolean;
  visit_buffer_minutes: string;
  preferred_contact_name: string;
  preferred_contact_phone: string;
  notes: string;
  residence_lat: string;
  residence_lng: string;
  geocode_status: string;
  geocode_source: string;
  geocode_accuracy: string;
};

const WEEKDAY_OPTIONS = [
  { value: 1, label: '月' },
  { value: 2, label: '火' },
  { value: 3, label: '水' },
  { value: 4, label: '木' },
  { value: 5, label: '金' },
  { value: 6, label: '土' },
  { value: 0, label: '日' },
];

const EMPTY_FORM: VisitConstraintsFormState = {
  preferred_weekdays: [],
  preferred_time_from: '',
  preferred_time_to: '',
  phone_contact_from: '',
  phone_contact_to: '',
  facility_time_from: '',
  facility_time_to: '',
  family_presence_required: false,
  visit_buffer_minutes: '',
  preferred_contact_name: '',
  preferred_contact_phone: '',
  notes: '',
  residence_lat: '',
  residence_lng: '',
  geocode_status: '',
  geocode_source: '',
  geocode_accuracy: '',
};

function toTimeValue(value: string | null | undefined) {
  if (!value) return '';
  return value.slice(11, 16);
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return '未記録';
  try {
    return new Intl.DateTimeFormat('ja-JP', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function toFormState(response?: VisitConstraintsResponse): VisitConstraintsFormState {
  const pref = response?.data.scheduling_preference;
  const residence = response?.data.residence;

  return {
    preferred_weekdays: pref?.preferred_weekdays ?? [],
    preferred_time_from: toTimeValue(pref?.preferred_time_from),
    preferred_time_to: toTimeValue(pref?.preferred_time_to),
    phone_contact_from: toTimeValue(pref?.phone_contact_from),
    phone_contact_to: toTimeValue(pref?.phone_contact_to),
    facility_time_from: toTimeValue(pref?.facility_time_from),
    facility_time_to: toTimeValue(pref?.facility_time_to),
    family_presence_required: pref?.family_presence_required ?? false,
    visit_buffer_minutes:
      pref?.visit_buffer_minutes != null ? String(pref.visit_buffer_minutes) : '',
    preferred_contact_name: pref?.preferred_contact_name ?? '',
    preferred_contact_phone: pref?.preferred_contact_phone ?? '',
    notes: pref?.notes ?? '',
    residence_lat: residence?.lat != null ? String(residence.lat) : '',
    residence_lng: residence?.lng != null ? String(residence.lng) : '',
    geocode_status: residence?.geocode_status ?? '',
    geocode_source: residence?.geocode_source ?? '',
    geocode_accuracy: residence?.geocode_accuracy ?? '',
  };
}

function updateDraftForm(
  current: VisitConstraintsFormState | null,
  base: VisitConstraintsFormState,
  patch: Partial<VisitConstraintsFormState>,
) {
  return {
    ...(current ?? base),
    ...patch,
  };
}

export function VisitConstraintsCard({ patientId, orgId }: { patientId: string; orgId: string }) {
  const queryClient = useQueryClient();
  const [draftForm, setDraftForm] = useState<VisitConstraintsFormState | null>(null);

  const { data, isLoading } = useQuery<VisitConstraintsResponse>({
    queryKey: ['visit-constraints', orgId, patientId],
    queryFn: async () => {
      const res = await fetch(`/api/patients/${patientId}/visit-constraints`, {
        headers: { 'x-org-id': orgId },
      });
      if (!res.ok) throw new Error('訪問条件の取得に失敗しました');
      return res.json() as Promise<VisitConstraintsResponse>;
    },
    enabled: !!orgId,
  });

  const serverForm = useMemo(() => (data ? toFormState(data) : EMPTY_FORM), [data]);
  const form = draftForm ?? serverForm;

  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/patients/${patientId}/visit-constraints`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'x-org-id': orgId,
        },
        body: JSON.stringify({
          preferred_weekdays: form.preferred_weekdays,
          preferred_time_from: form.preferred_time_from || undefined,
          preferred_time_to: form.preferred_time_to || undefined,
          phone_contact_from: form.phone_contact_from || undefined,
          phone_contact_to: form.phone_contact_to || undefined,
          facility_time_from: form.facility_time_from || undefined,
          facility_time_to: form.facility_time_to || undefined,
          family_presence_required: form.family_presence_required,
          visit_buffer_minutes: form.visit_buffer_minutes
            ? Number(form.visit_buffer_minutes)
            : undefined,
          preferred_contact_name: form.preferred_contact_name || undefined,
          preferred_contact_phone: form.preferred_contact_phone || undefined,
          notes: form.notes || undefined,
          residence_lat: form.residence_lat ? Number(form.residence_lat) : undefined,
          residence_lng: form.residence_lng ? Number(form.residence_lng) : undefined,
          geocode_status: form.geocode_status || undefined,
          geocode_source: form.geocode_source || undefined,
          geocode_accuracy: form.geocode_accuracy || undefined,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((json as { message?: string }).message ?? '訪問条件の保存に失敗しました');
      }
      return json;
    },
    onSuccess: async () => {
      toast.success('訪問条件を保存しました');
      setDraftForm(null);
      await invalidateQueryKeys(queryClient, getPatientCareQueryKeys({ orgId, patientId }));
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : '訪問条件の保存に失敗しました');
    },
  });

  const selectedWeekdayLabels = useMemo(
    () =>
      WEEKDAY_OPTIONS.filter((weekday) => form.preferred_weekdays.includes(weekday.value)).map(
        (weekday) => weekday.label,
      ),
    [form.preferred_weekdays],
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">訪問条件・連絡制約</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          {selectedWeekdayLabels.length > 0 ? (
            selectedWeekdayLabels.map((label) => (
              <Badge
                key={label}
                variant="outline"
                className="border-sky-200 bg-sky-50 text-sky-700"
              >
                {label}
              </Badge>
            ))
          ) : (
            <span className="text-sm text-muted-foreground">曜日希望は未設定です</span>
          )}
        </div>

        {isLoading ? (
          <div className="h-32 animate-pulse rounded-lg bg-muted" />
        ) : (
          <>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label>訪問希望曜日</Label>
                <div className="flex flex-wrap gap-2">
                  {WEEKDAY_OPTIONS.map((weekday) => {
                    const checked = form.preferred_weekdays.includes(weekday.value);
                    return (
                      <label
                        key={weekday.value}
                        className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm"
                      >
                        <Checkbox
                          checked={checked}
                          onCheckedChange={(next) =>
                            setDraftForm((current) =>
                              updateDraftForm(current, form, {
                                preferred_weekdays: next
                                  ? [...form.preferred_weekdays, weekday.value]
                                  : form.preferred_weekdays.filter(
                                      (value) => value !== weekday.value,
                                    ),
                              }),
                            )
                          }
                        />
                        <span>{weekday.label}</span>
                      </label>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="visit-buffer">訪問前後バッファ(分)</Label>
                <Input
                  id="visit-buffer"
                  type="number"
                  value={form.visit_buffer_minutes}
                  onChange={(event) =>
                    setDraftForm((current) =>
                      updateDraftForm(current, form, {
                        visit_buffer_minutes: event.target.value,
                      }),
                    )
                  }
                />
              </div>

              <TimeRange
                label="訪問希望時間帯"
                from={form.preferred_time_from}
                to={form.preferred_time_to}
                onChange={(field, value) =>
                  setDraftForm((current) => updateDraftForm(current, form, { [field]: value }))
                }
                fromField="preferred_time_from"
                toField="preferred_time_to"
              />
              <TimeRange
                label="電話連絡可能時間"
                from={form.phone_contact_from}
                to={form.phone_contact_to}
                onChange={(field, value) =>
                  setDraftForm((current) => updateDraftForm(current, form, { [field]: value }))
                }
                fromField="phone_contact_from"
                toField="phone_contact_to"
              />
              <TimeRange
                label="施設受入時間"
                from={form.facility_time_from}
                to={form.facility_time_to}
                onChange={(field, value) =>
                  setDraftForm((current) => updateDraftForm(current, form, { [field]: value }))
                }
                fromField="facility_time_from"
                toField="facility_time_to"
              />

              <div className="space-y-1.5">
                <Label htmlFor="preferred-contact-name">優先連絡先名</Label>
                <Input
                  id="preferred-contact-name"
                  value={form.preferred_contact_name}
                  onChange={(event) =>
                    setDraftForm((current) =>
                      updateDraftForm(current, form, {
                        preferred_contact_name: event.target.value,
                      }),
                    )
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="preferred-contact-phone">優先連絡先電話</Label>
                <Input
                  id="preferred-contact-phone"
                  value={form.preferred_contact_phone}
                  onChange={(event) =>
                    setDraftForm((current) =>
                      updateDraftForm(current, form, {
                        preferred_contact_phone: event.target.value,
                      }),
                    )
                  }
                />
              </div>
            </div>

            <label className="flex items-center gap-3 rounded-lg border px-3 py-2 text-sm">
              <Checkbox
                checked={form.family_presence_required}
                onCheckedChange={(checked) =>
                  setDraftForm((current) =>
                    updateDraftForm(current, form, {
                      family_presence_required: Boolean(checked),
                    }),
                  )
                }
              />
              <span>家族同席が必要</span>
            </label>

            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="residence-lat">緯度</Label>
                <Input
                  id="residence-lat"
                  value={form.residence_lat}
                  onChange={(event) =>
                    setDraftForm((current) =>
                      updateDraftForm(current, form, {
                        residence_lat: event.target.value,
                      }),
                    )
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="residence-lng">経度</Label>
                <Input
                  id="residence-lng"
                  value={form.residence_lng}
                  onChange={(event) =>
                    setDraftForm((current) =>
                      updateDraftForm(current, form, {
                        residence_lng: event.target.value,
                      }),
                    )
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="geocode-status">ジオコード状態</Label>
                <Input
                  id="geocode-status"
                  value={form.geocode_status}
                  onChange={(event) =>
                    setDraftForm((current) =>
                      updateDraftForm(current, form, {
                        geocode_status: event.target.value,
                      }),
                    )
                  }
                  placeholder="verified / pending"
                />
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="geocode-source">ジオコードソース</Label>
                <Input
                  id="geocode-source"
                  value={form.geocode_source}
                  onChange={(event) =>
                    setDraftForm((current) =>
                      updateDraftForm(current, form, {
                        geocode_source: event.target.value,
                      }),
                    )
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="geocode-accuracy">精度</Label>
                <Input
                  id="geocode-accuracy"
                  value={form.geocode_accuracy}
                  onChange={(event) =>
                    setDraftForm((current) =>
                      updateDraftForm(current, form, {
                        geocode_accuracy: event.target.value,
                      }),
                    )
                  }
                />
              </div>
            </div>

            <div className="rounded-lg border border-border/70 bg-muted/10 px-3 py-2 text-sm">
              <span className="text-muted-foreground">最終ジオコード更新</span>
              <span className="ml-2 text-foreground">
                {formatDateTime(data?.data.residence?.geocoded_at)}
              </span>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="visit-constraint-notes">備考</Label>
              <Textarea
                id="visit-constraint-notes"
                rows={4}
                value={form.notes}
                onChange={(event) =>
                  setDraftForm((current) =>
                    updateDraftForm(current, form, {
                      notes: event.target.value,
                    }),
                  )
                }
              />
            </div>

            <div className="flex justify-end">
              <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
                {saveMutation.isPending ? '保存中...' : '保存'}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function TimeRange({
  label,
  from,
  to,
  onChange,
  fromField,
  toField,
}: {
  label: string;
  from: string;
  to: string;
  onChange: (field: keyof VisitConstraintsFormState, value: string) => void;
  fromField: keyof VisitConstraintsFormState;
  toField: keyof VisitConstraintsFormState;
}) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="space-y-1.5">
        <Label>{label} 開始</Label>
        <Input
          type="time"
          value={from}
          onChange={(event) => onChange(fromField, event.target.value)}
        />
      </div>
      <div className="space-y-1.5">
        <Label>{label} 終了</Label>
        <Input type="time" value={to} onChange={(event) => onChange(toField, event.target.value)} />
      </div>
    </div>
  );
}
