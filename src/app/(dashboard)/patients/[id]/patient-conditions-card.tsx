'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ActionRail } from '@/components/ui/action-rail';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
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
import { getPatientCareQueryKeys, invalidateQueryKeys } from '@/lib/visits/query-invalidations';

type ConditionRow = {
  id?: string;
  condition_type: 'disease' | 'problem';
  name: string;
  is_primary: boolean;
  is_active: boolean;
  noted_at: string;
  notes: string;
};

export function PatientConditionsCard({
  patientId,
  orgId,
  initialConditions,
}: {
  patientId: string;
  orgId: string;
  initialConditions: Array<{
    id: string;
    condition_type: 'disease' | 'problem';
    name: string;
    is_primary: boolean;
    is_active: boolean;
    noted_at: string | null;
    notes: string | null;
  }>;
}) {
  const queryClient = useQueryClient();
  const [conditions, setConditions] = useState<ConditionRow[]>(
    initialConditions.length > 0
      ? initialConditions.map((condition) => ({
          id: condition.id,
          condition_type: condition.condition_type,
          name: condition.name,
          is_primary: condition.is_primary,
          is_active: condition.is_active,
          noted_at: condition.noted_at?.slice(0, 10) ?? '',
          notes: condition.notes ?? '',
        }))
      : [
          {
            condition_type: 'disease',
            name: '',
            is_primary: true,
            is_active: true,
            noted_at: '',
            notes: '',
          },
        ],
  );

  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/patients/${patientId}/conditions`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'x-org-id': orgId,
        },
        body: JSON.stringify({
          conditions: conditions
            .filter((condition) => condition.name.trim())
            .map((condition) => ({
              condition_type: condition.condition_type,
              name: condition.name.trim(),
              is_primary: condition.is_primary,
              is_active: condition.is_active,
              noted_at: condition.noted_at || undefined,
              notes: condition.notes || undefined,
            })),
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (payload as { message?: string }).message ?? '病名・課題リストの保存に失敗しました',
        );
      }
      return payload;
    },
    onSuccess: async () => {
      toast.success('病名・課題リストを更新しました');
      await invalidateQueryKeys(queryClient, getPatientCareQueryKeys({ orgId, patientId }));
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : '病名・課題リストの保存に失敗しました');
    },
  });

  return (
    <Card>
      <CardHeader>
        <h2 className="font-heading text-base leading-snug font-medium">病名・課題リスト</h2>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {conditions
            .filter((condition) => condition.name.trim())
            .map((condition, index) => (
              <Badge
                key={`${condition.condition_type}-${condition.name}-${index}`}
                variant="outline"
              >
                {condition.condition_type === 'disease' ? '疾患' : '課題'}: {condition.name}
              </Badge>
            ))}
        </div>

        <div className="space-y-3">
          {conditions.map((condition, index) => (
            <div key={condition.id ?? `new-${index}`} className="rounded-lg border p-3">
              <div className="grid gap-3 md:grid-cols-[180px_1fr]">
                <div className="space-y-1.5">
                  <Label>区分</Label>
                  <Select
                    value={condition.condition_type}
                    onValueChange={(value) =>
                      setConditions((current) =>
                        current.map((item, itemIndex) =>
                          itemIndex === index
                            ? { ...item, condition_type: value as ConditionRow['condition_type'] }
                            : item,
                        ),
                      )
                    }
                  >
                    <SelectTrigger aria-label={`病名・課題${index + 1}件目の区分`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="disease">疾患名</SelectItem>
                      <SelectItem value="problem">問題・課題</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>名称</Label>
                  <Input
                    aria-label={`病名・課題${index + 1}件目の名称`}
                    value={condition.name}
                    onChange={(event) =>
                      setConditions((current) =>
                        current.map((item, itemIndex) =>
                          itemIndex === index ? { ...item, name: event.target.value } : item,
                        ),
                      )
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>把握日</Label>
                  <Input
                    aria-label={`病名・課題${index + 1}件目の把握日`}
                    type="date"
                    value={condition.noted_at}
                    onChange={(event) =>
                      setConditions((current) =>
                        current.map((item, itemIndex) =>
                          itemIndex === index ? { ...item, noted_at: event.target.value } : item,
                        ),
                      )
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>メモ</Label>
                  <Textarea
                    aria-label={`病名・課題${index + 1}件目のメモ`}
                    rows={2}
                    value={condition.notes}
                    onChange={(event) =>
                      setConditions((current) =>
                        current.map((item, itemIndex) =>
                          itemIndex === index ? { ...item, notes: event.target.value } : item,
                        ),
                      )
                    }
                  />
                </div>
              </div>

              <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-4 text-sm">
                  <label className="flex items-center gap-2">
                    <Checkbox
                      aria-label={`病名・課題${index + 1}件目を主要課題にする`}
                      checked={condition.is_primary}
                      onCheckedChange={(checked) =>
                        setConditions((current) =>
                          current.map((item, itemIndex) =>
                            itemIndex === index ? { ...item, is_primary: Boolean(checked) } : item,
                          ),
                        )
                      }
                    />
                    <span>主要課題</span>
                  </label>
                  <label className="flex items-center gap-2">
                    <Checkbox
                      aria-label={`病名・課題${index + 1}件目を有効にする`}
                      checked={condition.is_active}
                      onCheckedChange={(checked) =>
                        setConditions((current) =>
                          current.map((item, itemIndex) =>
                            itemIndex === index ? { ...item, is_active: Boolean(checked) } : item,
                          ),
                        )
                      }
                    />
                    <span>有効</span>
                  </label>
                </div>

                <Button
                  aria-label={`病名・課題${index + 1}件目を削除`}
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    setConditions((current) =>
                      current.filter((_, itemIndex) => itemIndex !== index),
                    )
                  }
                  disabled={conditions.length === 1}
                >
                  <Trash2 className="mr-1 size-4" />
                  削除
                </Button>
              </div>
            </div>
          ))}
        </div>

        <ActionRail align="between">
          <Button
            type="button"
            variant="outline"
            onClick={() =>
              setConditions((current) => [
                ...current,
                {
                  condition_type: 'problem',
                  name: '',
                  is_primary: false,
                  is_active: true,
                  noted_at: '',
                  notes: '',
                },
              ])
            }
          >
            <Plus className="mr-1 size-4" />
            行追加
          </Button>
          <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
            {saveMutation.isPending ? '保存中...' : '保存'}
          </Button>
        </ActionRail>
      </CardContent>
    </Card>
  );
}
