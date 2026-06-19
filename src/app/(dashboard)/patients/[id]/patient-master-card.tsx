'use client';

import {
  cloneElement,
  isValidElement,
  useId,
  useState,
  type ReactNode,
  type ReactElement,
} from 'react';
import type { AllergyEntry } from '@/lib/validations/patient-allergy';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { ShieldCheck } from 'lucide-react';
import { ActionRail } from '@/components/ui/action-rail';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
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
import { GENDER_LABELS } from '@/lib/constants/status-labels';
import { getPatientCareQueryKeys, invalidateQueryKeys } from '@/lib/visits/query-invalidations';

type FacilityOption = {
  id: string;
  name: string;
  address: string | null;
};

type FacilityUnitOption = {
  id: string;
  name: string;
  floor: string | null;
  unit_type: string | null;
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
    billing_support_flag: boolean;
    allergy_info: AllergyEntry[] | null;
    notes: string | null;
    residences: Array<{
      id: string;
      address: string;
      building_id: string | null;
      facility_id?: string | null;
      facility_unit_id?: string | null;
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
  const intakeCase =
    patient.cases?.find((c) => getHomeVisitIntake(c.required_visit_support)) ?? null;
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
    billing_support_flag: patient.billing_support_flag,
    address: primaryResidence?.address ?? '',
    facility_id: primaryResidence?.facility_id ?? '',
    facility_unit_id: primaryResidence?.facility_unit_id ?? '',
    building_id: primaryResidence?.building_id ?? '',
    unit_name: primaryResidence?.unit_name ?? '',
    allergy_info: (patient.allergy_info ?? []) as AllergyEntry[],
    notes: patient.notes ?? '',
  });
  const selectedFacilityId = form.facility_id;
  const facilityUnitsQuery = useQuery({
    queryKey: ['patient-master-facility-units', orgId, selectedFacilityId],
    queryFn: async () => {
      const response = await fetch(`/api/admin/facilities/${selectedFacilityId}/units`, {
        headers: { 'x-org-id': orgId },
      });
      if (!response.ok) throw new Error('ユニット一覧の取得に失敗しました');
      return response.json() as Promise<{ data: FacilityUnitOption[] }>;
    },
    enabled: !!orgId && !!selectedFacilityId,
  });

  const qualificationCheckMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/patients/${patient.id}/qualification-check`, {
        method: 'POST',
        headers: { 'x-org-id': orgId },
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 501) {
          throw new Error('オンライン資格確認はまだ有効化されていません');
        }
        throw new Error((payload as { message?: string }).message ?? '資格確認に失敗しました');
      }
      return payload as {
        data: { valid: boolean; payerName: string | null; copayRatio: number | null } | null;
      };
    },
    onSuccess: (result) => {
      if (!result.data) {
        toast.info('資格情報が見つかりませんでした');
        return;
      }
      const { valid, payerName, copayRatio } = result.data;
      if (valid) {
        toast.success(
          `資格確認OK: ${payerName ?? '保険者不明'}${copayRatio != null ? ` / 負担割合 ${copayRatio * 100}%` : ''}`,
        );
      } else {
        toast.warning('資格確認: 保険資格が無効または期限切れです');
      }
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : '資格確認に失敗しました');
    },
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
          billing_support_flag: form.billing_support_flag,
          address: form.address || undefined,
          facility_id: form.facility_id || undefined,
          facility_unit_id: form.facility_unit_id || undefined,
          building_id: form.building_id || undefined,
          unit_name: form.unit_name || undefined,
          allergy_info: form.allergy_info,
          notes: form.notes || undefined,
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (payload as { message?: string }).message ?? '患者基本情報の保存に失敗しました',
        );
      }
      return payload;
    },
    onSuccess: async () => {
      toast.success('患者基本情報を更新しました');
      await invalidateQueryKeys(
        queryClient,
        getPatientCareQueryKeys({ orgId, patientId: patient.id }),
      );
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : '患者基本情報の保存に失敗しました');
    },
  });

  return (
    <Card>
      <CardHeader className="space-y-2">
        <h2 className="font-heading text-base leading-snug font-medium">患者マスタ</h2>
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
      <CardContent className="space-y-6">
        <fieldset className="space-y-3 rounded-2xl border border-border/70 bg-muted/20 p-4">
          <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            A. 基本属性
          </legend>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="氏名">
              <Input
                id="patient-master-name"
                value={form.name}
                onChange={(event) =>
                  setForm((current) => ({ ...current, name: event.target.value }))
                }
              />
            </Field>
            <Field label="フリガナ">
              <Input
                id="patient-master-name-kana"
                value={form.name_kana}
                onChange={(event) =>
                  setForm((current) => ({ ...current, name_kana: event.target.value }))
                }
              />
            </Field>
            <Field label="生年月日">
              <Input
                id="patient-master-birth-date"
                type="date"
                value={form.birth_date}
                onChange={(event) =>
                  setForm((current) => ({ ...current, birth_date: event.target.value }))
                }
              />
            </Field>
            <Field label="性別">
              <Select
                value={form.gender}
                onValueChange={(value) =>
                  setForm((current) => ({ ...current, gender: value ?? current.gender }))
                }
              >
                {/* Field の label は非ネイティブの Select trigger に htmlFor で結び付かないため、
                    アクセシブルネームを aria-label で明示する */}
                <SelectTrigger aria-label="性別">
                  <SelectValue placeholder="性別を選択">
                    {GENDER_LABELS[form.gender] ?? form.gender}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="male">男性</SelectItem>
                  <SelectItem value="female">女性</SelectItem>
                  <SelectItem value="other">その他</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </div>
        </fieldset>

        <fieldset className="space-y-3 rounded-2xl border border-border/70 bg-muted/20 p-4">
          <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            B. 連絡・住所
          </legend>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="電話番号">
              <Input
                id="patient-master-phone"
                value={form.phone}
                onChange={(event) =>
                  setForm((current) => ({ ...current, phone: event.target.value }))
                }
              />
            </Field>
            <Field label="住所">
              <Input
                id="patient-master-address"
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
                      facility_unit_id: '',
                    }));
                    return;
                  }
                  const selectedFacility = facilitiesQuery.data?.data.find(
                    (item) => item.id === value,
                  );
                  setForm((current) => ({
                    ...current,
                    facility_id: value,
                    facility_unit_id: current.facility_id === value ? current.facility_unit_id : '',
                    address: selectedFacility?.address ?? current.address,
                  }));
                }}
              >
                <SelectTrigger aria-label="施設">
                  <SelectValue placeholder="自宅または施設を選択" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="home">個人宅（自宅・同居人）</SelectItem>
                  {(facilitiesQuery.data?.data ?? []).map((facility) => (
                    <SelectItem key={facility.id} value={facility.id}>
                      {facility.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="ユニット">
              <Select
                value={form.facility_unit_id || 'none'}
                onValueChange={(value) =>
                  setForm((current) => ({
                    ...current,
                    facility_unit_id: !value || value === 'none' ? '' : value,
                  }))
                }
                disabled={!selectedFacilityId || facilityUnitsQuery.isLoading}
              >
                <SelectTrigger aria-label="ユニット">
                  <SelectValue
                    placeholder={
                      !selectedFacilityId
                        ? '施設を選択してください'
                        : facilityUnitsQuery.isLoading
                          ? 'ユニットを読み込み中...'
                          : 'ユニットを選択してください'
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">未設定</SelectItem>
                  {(facilityUnitsQuery.data?.data ?? []).map((unit) => (
                    <SelectItem key={unit.id} value={unit.id}>
                      {[unit.floor, unit.name].filter(Boolean).join(' / ')}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="同時訪問グループID">
              <Input
                id="patient-master-building-id"
                value={form.building_id}
                onChange={(event) =>
                  setForm((current) => ({ ...current, building_id: event.target.value }))
                }
                placeholder="例: 山田家 / 夫婦宅A"
              />
            </Field>
            <Field label="部屋番号等">
              <Input
                id="patient-master-unit-name"
                value={form.unit_name}
                onChange={(event) =>
                  setForm((current) => ({ ...current, unit_name: event.target.value }))
                }
              />
            </Field>
          </div>
        </fieldset>

        <fieldset className="space-y-3 rounded-2xl border border-border/70 bg-muted/20 p-4">
          <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            C. 保険
          </legend>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="医療保険番号" htmlFor="patient-medical-insurance-number">
              <div className="flex gap-2">
                <Input
                  id="patient-medical-insurance-number"
                  className="flex-1"
                  value={form.medical_insurance_number}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      medical_insurance_number: event.target.value,
                    }))
                  }
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="shrink-0"
                  onClick={() => qualificationCheckMutation.mutate()}
                  disabled={qualificationCheckMutation.isPending}
                  title="オンライン資格確認"
                >
                  <ShieldCheck className="h-4 w-4 mr-1" />
                  {qualificationCheckMutation.isPending ? '確認中...' : '資格確認'}
                </Button>
              </div>
            </Field>
            <Field label="介護保険番号">
              <Input
                id="patient-master-care-insurance-number"
                value={form.care_insurance_number}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    care_insurance_number: event.target.value,
                  }))
                }
              />
            </Field>
            <Field label="請求支援フラグ">
              <label className="flex min-h-10 items-center gap-3 rounded-lg border border-border/70 px-3 py-2 text-sm">
                <Checkbox
                  checked={form.billing_support_flag}
                  onCheckedChange={(checked) =>
                    setForm((current) => ({
                      ...current,
                      billing_support_flag: checked === true,
                    }))
                  }
                />
                <span>請求支援が必要な患者として扱う</span>
              </label>
            </Field>
          </div>
        </fieldset>

        <fieldset className="space-y-3 rounded-2xl border border-border/70 bg-muted/20 p-4">
          <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            D. アレルギー
          </legend>
          <div className="space-y-2">
            <Label className="block mb-1.5">アレルギー情報</Label>
            {form.allergy_info.map((entry, index) => (
              <div key={index} className="flex gap-2 items-center">
                <Input
                  aria-label={`アレルギー${index + 1}件目の名称`}
                  className="flex-1"
                  value={entry.drug_name}
                  onChange={(event) =>
                    setForm((current) => {
                      const updated = [...current.allergy_info];
                      updated[index] = { ...updated[index], drug_name: event.target.value };
                      return { ...current, allergy_info: updated };
                    })
                  }
                  placeholder="薬剤名・食品名"
                />
                <Select
                  value={entry.category}
                  onValueChange={(value) =>
                    setForm((current) => {
                      const updated = [...current.allergy_info];
                      updated[index] = {
                        ...updated[index],
                        category: value as AllergyEntry['category'],
                      };
                      return { ...current, allergy_info: updated };
                    })
                  }
                >
                  <SelectTrigger className="w-28" aria-label={`アレルギー${index + 1}件目の区分`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="drug">薬剤</SelectItem>
                    <SelectItem value="food">食品</SelectItem>
                    <SelectItem value="other">その他</SelectItem>
                  </SelectContent>
                </Select>
                <Select
                  value={entry.severity}
                  onValueChange={(value) =>
                    setForm((current) => {
                      const updated = [...current.allergy_info];
                      updated[index] = {
                        ...updated[index],
                        severity: value as AllergyEntry['severity'],
                      };
                      return { ...current, allergy_info: updated };
                    })
                  }
                >
                  <SelectTrigger className="w-28" aria-label={`アレルギー${index + 1}件目の重症度`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="unknown">不明</SelectItem>
                    <SelectItem value="mild">軽度</SelectItem>
                    <SelectItem value="moderate">中等度</SelectItem>
                    <SelectItem value="severe">重度</SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    setForm((current) => ({
                      ...current,
                      allergy_info: current.allergy_info.filter((_, i) => i !== index),
                    }))
                  }
                >
                  削除
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                setForm((current) => ({
                  ...current,
                  allergy_info: [
                    ...current.allergy_info,
                    { drug_name: '', category: 'drug', severity: 'unknown' },
                  ],
                }))
              }
            >
              + アレルギー追加
            </Button>
          </div>
        </fieldset>

        <fieldset className="space-y-3 rounded-2xl border border-border/70 bg-muted/20 p-4">
          <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            E. 補助メモ
          </legend>
          <Field label="患者メモ">
            <Textarea
              id="patient-master-notes"
              rows={4}
              value={form.notes}
              onChange={(event) =>
                setForm((current) => ({ ...current, notes: event.target.value }))
              }
            />
          </Field>
        </fieldset>

        <ActionRail>
          <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
            {saveMutation.isPending ? '保存中...' : '保存'}
          </Button>
        </ActionRail>
      </CardContent>
    </Card>
  );
}

function Field({
  label,
  htmlFor,
  children,
  className,
}: {
  label: string;
  htmlFor?: string;
  children: ReactNode;
  className?: string;
}) {
  const autoId = useId();
  const fieldId = `field-${autoId}`;

  const canBindLabel =
    isValidElement(children) && (children.type === Input || children.type === Textarea);
  const childProps = canBindLabel ? (children.props as { id?: unknown }) : null;
  const boundId = htmlFor ?? (typeof childProps?.id === 'string' ? childProps.id : fieldId);

  return (
    <div className={className}>
      <Label htmlFor={htmlFor ?? (canBindLabel ? boundId : undefined)} className="mb-1.5 block">
        {label}
      </Label>
      {canBindLabel
        ? cloneElement(children as ReactElement<{ id?: string }>, { id: boundId })
        : children}
    </div>
  );
}
