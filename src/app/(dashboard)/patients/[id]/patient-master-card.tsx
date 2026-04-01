'use client';

import { useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
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
import { buildIntakeBadges, getHomeVisitIntake } from '@/lib/patient/intake-display';
import { getPatientCareQueryKeys, invalidateQueryKeys } from '@/lib/visits/query-invalidations';

type FacilityOption = {
  id: string;
  name: string;
  address: string | null;
};

type PatientMasterCardProps = {
  orgId: string;
  patient: {
    id: string;
    name: string;
    name_kana: string;
    birth_date: string;
    gender: string;
    phone: string | null;
    medical_insurance_number: string | null;
    care_insurance_number: string | null;
    allergy_info: string[] | null;
    notes: string | null;
    residences: Array<{
      id: string;
      address: string;
      building_id: string | null;
      facility_id?: string | null;
      unit_name: string | null;
      is_primary: boolean;
    }>;
    cases?: Array<{
      required_visit_support: Record<string, unknown> | null;
    }>;
  };
};

export function PatientMasterCard({ orgId, patient }: PatientMasterCardProps) {
  const queryClient = useQueryClient();
  const primaryResidence = patient.residences.find((residence) => residence.is_primary) ?? null;

  // Resolve the first case that has intake data and derive compact badges
  const intakeCase = patient.cases?.find((c) => getHomeVisitIntake(c.required_visit_support)) ?? null;
  const intake = intakeCase ? getHomeVisitIntake(intakeCase.required_visit_support) : null;
  const intakeBadges = buildIntakeBadges(intake);
  const facilitiesQuery = useQuery({
    queryKey: ['patient-master-facilities', orgId],
    queryFn: async () => {
      const response = await fetch('/api/facilities', {
        headers: { 'x-org-id': orgId },
      });
      if (!response.ok) throw new Error('施設マスターの取得に失敗しました');
      return response.json() as Promise<{ data: FacilityOption[] }>;
    },
    enabled: !!orgId,
  });

  const [form, setForm] = useState({
    name: patient.name,
    name_kana: patient.name_kana,
    birth_date: patient.birth_date.slice(0, 10),
    gender: patient.gender,
    phone: patient.phone ?? '',
    medical_insurance_number: patient.medical_insurance_number ?? '',
    care_insurance_number: patient.care_insurance_number ?? '',
    address: primaryResidence?.address ?? '',
    facility_id: primaryResidence?.facility_id ?? '',
    building_id: primaryResidence?.building_id ?? '',
    unit_name: primaryResidence?.unit_name ?? '',
    allergy_info: patient.allergy_info?.join('\n') ?? '',
    notes: patient.notes ?? '',
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/patients/${patient.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'x-org-id': orgId,
        },
        body: JSON.stringify({
          name: form.name,
          name_kana: form.name_kana,
          birth_date: form.birth_date,
          gender: form.gender,
          phone: form.phone || undefined,
          medical_insurance_number: form.medical_insurance_number || undefined,
          care_insurance_number: form.care_insurance_number || undefined,
          address: form.address || undefined,
          facility_id: form.facility_id || undefined,
          building_id: form.building_id || undefined,
          unit_name: form.unit_name || undefined,
          allergy_info: form.allergy_info
            ? form.allergy_info
                .split(/\r?\n/)
                .map((item) => item.trim())
                .filter(Boolean)
            : [],
          notes: form.notes || undefined,
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((payload as { message?: string }).message ?? '患者基本情報の保存に失敗しました');
      }
      return payload;
    },
    onSuccess: async () => {
      toast.success('患者基本情報を更新しました');
      await invalidateQueryKeys(
        queryClient,
        getPatientCareQueryKeys({ orgId, patientId: patient.id })
      );
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : '患者基本情報の保存に失敗しました');
    },
  });

  return (
    <Card>
      <CardHeader className="space-y-2">
        <CardTitle className="text-base">患者マスタ</CardTitle>
        {intakeBadges.length > 0 && (
          <div className="flex flex-wrap gap-1.5" aria-label="インテーク情報サマリ">
            {intakeBadges.map((badge) => (
              <Badge
                key={badge.key}
                variant={badge.highlight ? 'destructive' : 'secondary'}
                className="text-xs font-normal"
              >
                <span className="mr-1 text-muted-foreground">{badge.label}</span>
                {badge.value}
              </Badge>
            ))}
          </div>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="氏名">
            <Input
              value={form.name}
              onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
            />
          </Field>
          <Field label="フリガナ">
            <Input
              value={form.name_kana}
              onChange={(event) =>
                setForm((current) => ({ ...current, name_kana: event.target.value }))
              }
            />
          </Field>
          <Field label="生年月日">
            <Input
              type="date"
              value={form.birth_date}
              onChange={(event) =>
                setForm((current) => ({ ...current, birth_date: event.target.value }))
              }
            />
          </Field>
          <Field label="性別">
            <Input
              value={form.gender}
              onChange={(event) => setForm((current) => ({ ...current, gender: event.target.value }))}
            />
          </Field>
          <Field label="電話番号">
            <Input
              value={form.phone}
              onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))}
            />
          </Field>
          <Field label="住所">
            <Input
              value={form.address}
              onChange={(event) =>
                setForm((current) => ({ ...current, address: event.target.value }))
              }
            />
          </Field>
          <Field label="施設">
            <Select
              value={form.facility_id || 'home'}
              onValueChange={(value) => {
                if (!value || value === 'home') {
                  setForm((current) => ({
                    ...current,
                    facility_id: '',
                  }));
                  return;
                }
                const selectedFacility = facilitiesQuery.data?.data.find((item) => item.id === value);
                setForm((current) => ({
                  ...current,
                  facility_id: value,
                  address: selectedFacility?.address ?? current.address,
                }));
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="自宅または施設を選択" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="home">自宅・手入力</SelectItem>
                {(facilitiesQuery.data?.data ?? []).map((facility) => (
                  <SelectItem key={facility.id} value={facility.id}>
                    {facility.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="建物ID">
            <Input
              value={form.building_id}
              onChange={(event) =>
                setForm((current) => ({ ...current, building_id: event.target.value }))
              }
            />
          </Field>
          <Field label="部屋番号等">
            <Input
              value={form.unit_name}
              onChange={(event) =>
                setForm((current) => ({ ...current, unit_name: event.target.value }))
              }
            />
          </Field>
          <Field label="医療保険番号">
            <Input
              value={form.medical_insurance_number}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  medical_insurance_number: event.target.value,
                }))
              }
            />
          </Field>
          <Field label="介護保険番号">
            <Input
              value={form.care_insurance_number}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  care_insurance_number: event.target.value,
                }))
              }
            />
          </Field>
          <Field label="アレルギー情報" className="md:col-span-2">
            <Textarea
              rows={3}
              value={form.allergy_info}
              onChange={(event) =>
                setForm((current) => ({ ...current, allergy_info: event.target.value }))
              }
              placeholder="1行1件で入力"
            />
          </Field>
          <Field label="患者メモ" className="md:col-span-2">
            <Textarea
              rows={4}
              value={form.notes}
              onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
            />
          </Field>
        </div>

        <div className="flex justify-end">
          <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
            {saveMutation.isPending ? '保存中...' : '保存'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <Label className="mb-1.5 block">{label}</Label>
      {children}
    </div>
  );
}
