'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import {
  PACKAGING_METHOD_LABELS,
  PACKAGING_METHOD_OPTIONS,
  type PackagingMethodValue,
} from '@/lib/prescription/packaging';
import { getPatientCareQueryKeys, invalidateQueryKeys } from '@/lib/visits/query-invalidations';

type PackagingResponse = {
  data: {
    packaging_profile: {
      default_packaging_method: PackagingMethodValue | null;
      medication_box_color: string | null;
      notes: string | null;
      updated_at: string;
    } | null;
    effective_summary: string | null;
  };
};

type PackagingFormState = {
  default_packaging_method: PackagingMethodValue | '';
  medication_box_color: string;
  notes: string;
};

const EMPTY_FORM: PackagingFormState = {
  default_packaging_method: '',
  medication_box_color: '',
  notes: '',
};

function toFormState(response?: PackagingResponse): PackagingFormState {
  const profile = response?.data.packaging_profile;
  return {
    default_packaging_method: profile?.default_packaging_method ?? '',
    medication_box_color: profile?.medication_box_color ?? '',
    notes: profile?.notes ?? '',
  };
}

function isMedicationBoxMethod(value: PackagingFormState['default_packaging_method']) {
  return value === 'medication_box';
}

export function PatientPackagingCard({
  patientId,
  orgId,
}: {
  patientId: string;
  orgId: string;
}) {
  const queryClient = useQueryClient();
  const [draftForm, setDraftForm] = useState<PackagingFormState | null>(null);

  const { data, isLoading } = useQuery<PackagingResponse>({
    queryKey: ['patient-packaging', orgId, patientId],
    queryFn: async () => {
      const res = await fetch(`/api/patients/${patientId}/packaging`, {
        headers: { 'x-org-id': orgId },
      });
      if (!res.ok) throw new Error('患者配薬設定の取得に失敗しました');
      return res.json() as Promise<PackagingResponse>;
    },
    enabled: !!orgId,
  });

  const serverForm = useMemo(() => (data ? toFormState(data) : EMPTY_FORM), [data]);
  const form = draftForm ?? serverForm;

  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/patients/${patientId}/packaging`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'x-org-id': orgId,
        },
        body: JSON.stringify({
          default_packaging_method: form.default_packaging_method || null,
          medication_box_color: form.medication_box_color || undefined,
          notes: form.notes || undefined,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((json as { message?: string }).message ?? '患者配薬設定の保存に失敗しました');
      }
      return json;
    },
    onSuccess: async () => {
      toast.success('患者固有の配薬設定を保存しました');
      setDraftForm(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['patient-packaging', orgId, patientId] }),
        invalidateQueryKeys(queryClient, getPatientCareQueryKeys({ orgId, patientId })),
      ]);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : '患者配薬設定の保存に失敗しました');
    },
  });

  return (
    <Card id="patient-packaging-card">
      <CardHeader>
        <CardTitle className="text-base">配薬設定</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          {data?.data.packaging_profile?.default_packaging_method ? (
            <Badge variant="outline" className="border-violet-200 bg-violet-50 text-violet-700">
              {
                PACKAGING_METHOD_LABELS[
                  data.data.packaging_profile.default_packaging_method
                ]
              }
            </Badge>
          ) : (
            <span className="text-sm text-muted-foreground">既定の配薬方法は未設定です</span>
          )}
          {data?.data.packaging_profile?.medication_box_color ? (
            <Badge variant="outline">BOX色 {data.data.packaging_profile.medication_box_color}</Badge>
          ) : null}
        </div>

        {data?.data.effective_summary ? (
          <div className="rounded-lg border border-border/70 bg-muted/30 px-3 py-2 text-sm">
            {data.data.effective_summary}
          </div>
        ) : null}

        {data?.data.packaging_profile?.updated_at ? (
          <p className="text-xs text-muted-foreground">
            最終更新: {data.data.packaging_profile.updated_at.slice(0, 16).replace('T', ' ')}
          </p>
        ) : null}

        {isLoading ? (
          <div className="h-28 animate-pulse rounded-lg bg-muted" />
        ) : (
          <div className="grid gap-4 md:grid-cols-[220px_1fr]">
            <div className="space-y-1.5">
              <Label htmlFor="default-packaging-method">既定配薬方法</Label>
              <Select
                value={form.default_packaging_method}
                onValueChange={(value) =>
                  setDraftForm((current) => ({
                    ...(current ?? form),
                    default_packaging_method: value as PackagingMethodValue | '',
                  }))
                }
              >
                <SelectTrigger id="default-packaging-method">
                  <SelectValue placeholder="既定配薬方法を選択" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">指定なし</SelectItem>
                  {PACKAGING_METHOD_OPTIONS.filter((option) => option.value !== 'none').map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="patient-packaging-note">患者固有メモ</Label>
              <Textarea
                id="patient-packaging-note"
                rows={3}
                value={form.notes}
                onChange={(event) =>
                  setDraftForm((current) => ({
                    ...(current ?? form),
                    notes: event.target.value,
                  }))
                }
                placeholder="朝だけ別包、食前薬はクリップ留めなど"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="medication-box-color">お薬BOX色</Label>
              <Input
                id="medication-box-color"
                value={form.medication_box_color}
                onChange={(event) =>
                  setDraftForm((current) => ({
                    ...(current ?? form),
                    medication_box_color: event.target.value,
                  }))
                }
                placeholder={isMedicationBoxMethod(form.default_packaging_method) ? '赤 / 青 / 緑' : '任意'}
              />
            </div>

            <div className="flex items-end justify-end">
              <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
                保存
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
