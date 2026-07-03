'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { messageFromError } from '@/lib/utils/error-message';
import { Skeleton } from '@/components/ui/loading';
import { ActionRail } from '@/components/ui/action-rail';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { ErrorState } from '@/components/ui/error-state';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { StateBadge } from '@/components/ui/state-badge';
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
} from '@/lib/dispensing/packaging';
import { buildOrgHeaders, buildOrgJsonHeaders } from '@/lib/api/org-headers';
import { buildPatientApiPath } from '@/lib/patient/api-paths';
import { getPatientCareQueryKeys, invalidateQueryKeys } from '@/lib/visits/query-invalidations';

type PackagingResponse = {
  data: {
    packaging_profile: {
      default_packaging_method: PackagingMethodValue | null;
      medication_box_color: string | null;
      notes: string | null;
      special_instructions: string | null;
      cognitive_note: string | null;
      updated_at: string;
    } | null;
    effective_summary: string | null;
  };
};

type PackagingFormState = {
  default_packaging_method: PackagingMethodValue | '';
  medication_box_color: string;
  notes: string;
  special_instructions: string;
  cognitive_note: string;
};

const EMPTY_FORM: PackagingFormState = {
  default_packaging_method: '',
  medication_box_color: '',
  notes: '',
  special_instructions: '',
  cognitive_note: '',
};

function toFormState(response?: PackagingResponse): PackagingFormState {
  const profile = response?.data.packaging_profile;
  return {
    default_packaging_method: profile?.default_packaging_method ?? '',
    medication_box_color: profile?.medication_box_color ?? '',
    notes: profile?.notes ?? '',
    special_instructions: profile?.special_instructions ?? '',
    cognitive_note: profile?.cognitive_note ?? '',
  };
}

function isMedicationBoxMethod(value: PackagingFormState['default_packaging_method']) {
  return value === 'medication_box';
}

export function PatientPackagingCard({ patientId, orgId }: { patientId: string; orgId: string }) {
  const queryClient = useQueryClient();
  const [draftForm, setDraftForm] = useState<PackagingFormState | null>(null);

  const { data, isLoading, isError, refetch } = useQuery<PackagingResponse>({
    queryKey: ['patient-packaging', orgId, patientId],
    queryFn: async () => {
      const res = await fetch(buildPatientApiPath(patientId, '/packaging'), {
        headers: buildOrgHeaders(orgId),
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
      const res = await fetch(buildPatientApiPath(patientId, '/packaging'), {
        method: 'PUT',
        headers: buildOrgJsonHeaders(orgId),
        body: JSON.stringify({
          default_packaging_method: form.default_packaging_method || null,
          medication_box_color: form.medication_box_color || undefined,
          notes: form.notes || undefined,
          special_instructions: form.special_instructions || undefined,
          cognitive_note: form.cognitive_note || undefined,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (json as { message?: string }).message ?? '患者配薬設定の保存に失敗しました',
        );
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
      toast.error(messageFromError(error, '患者配薬設定の保存に失敗しました'));
    },
  });

  return (
    <Card id="patient-packaging-card">
      <CardHeader>
        <h2 className="font-heading text-base leading-snug font-medium">配薬設定</h2>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          {isError ? (
            <Badge variant="destructive">取得できません</Badge>
          ) : data?.data.packaging_profile?.default_packaging_method ? (
            <StateBadge role="info" showIcon={false}>
              {PACKAGING_METHOD_LABELS[data.data.packaging_profile.default_packaging_method]}
            </StateBadge>
          ) : (
            <span className="text-sm text-muted-foreground">既定の配薬方法は未設定です</span>
          )}
          {!isError && data?.data.packaging_profile?.medication_box_color ? (
            <Badge variant="outline">
              BOX色 {data.data.packaging_profile.medication_box_color}
            </Badge>
          ) : null}
        </div>

        {!isError && data?.data.effective_summary ? (
          <div className="rounded-lg border border-border/70 bg-muted/30 px-3 py-2 text-sm">
            {data.data.effective_summary}
          </div>
        ) : null}

        {!isError && data?.data.packaging_profile?.updated_at ? (
          <p className="text-xs text-muted-foreground">
            最終更新: {data.data.packaging_profile.updated_at.slice(0, 16).replace('T', ' ')}
          </p>
        ) : null}

        {isLoading ? (
          <div role="status" aria-label="調剤・包装情報を読み込み中">
            <Skeleton className="h-28 rounded-lg" />
            <span className="sr-only">調剤・包装情報を読み込み中...</span>
          </div>
        ) : isError ? (
          <ErrorState
            variant="server"
            title="配薬設定を表示できません"
            description="患者固有の配薬方法と特記事項の取得に失敗しました。再試行してください。"
            detail="未設定として保存すると既存情報を上書きする可能性があるため、取得できるまで編集を停止しています。"
            onRetry={() => void refetch()}
            headingLevel={3}
          />
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
                  {PACKAGING_METHOD_OPTIONS.filter((option) => option.value !== 'none').map(
                    (option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ),
                  )}
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
              <Label htmlFor="patient-special-instructions">個別特記指示</Label>
              <Textarea
                id="patient-special-instructions"
                rows={3}
                value={form.special_instructions}
                onChange={(event) =>
                  setDraftForm((current) => ({
                    ...(current ?? form),
                    special_instructions: event.target.value,
                  }))
                }
                placeholder="配薬時の注意、手渡し順、施設連携の留意点など"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="patient-cognitive-note">認知・自己管理メモ</Label>
              <Textarea
                id="patient-cognitive-note"
                rows={3}
                value={form.cognitive_note}
                onChange={(event) =>
                  setDraftForm((current) => ({
                    ...(current ?? form),
                    cognitive_note: event.target.value,
                  }))
                }
                placeholder="飲み忘れ傾向、理解度、声かけの工夫など"
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
                placeholder={
                  isMedicationBoxMethod(form.default_packaging_method) ? '赤 / 青 / 緑' : '任意'
                }
              />
            </div>

            <ActionRail align="end" className="items-end">
              <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
                保存
              </Button>
            </ActionRail>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
