'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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

type CareTeamRow = {
  id?: string;
  role: 'physician' | 'nurse' | 'care_manager' | 'pharmacist' | 'other';
  name: string;
  organization_name: string;
  department: string;
  phone: string;
  email: string;
  fax: string;
  address: string;
  is_primary: boolean;
  notes: string;
};

const roleLabel: Record<CareTeamRow['role'], string> = {
  physician: '訪問診療医',
  nurse: '訪問看護師',
  care_manager: 'ケアマネジャー',
  pharmacist: '担当薬剤師',
  other: 'その他他職種',
};

export function PatientCareTeamPanel({
  patientId,
  orgId,
  cases,
}: {
  patientId: string;
  orgId: string;
  cases: Array<{
    id: string;
    status: string;
    care_team_links: Array<{
      id: string;
      role: string;
      name: string;
      organization_name: string | null;
      department: string | null;
      phone: string | null;
      email: string | null;
      fax: string | null;
      address: string | null;
      is_primary: boolean;
      notes: string | null;
    }>;
  }>;
}) {
  const queryClient = useQueryClient();
  const defaultCaseId =
    cases.find((careCase) => careCase.status === 'active')?.id ?? cases[0]?.id ?? '';
  const [selectedCaseId, setSelectedCaseId] = useState(defaultCaseId);
  const [drafts, setDrafts] = useState<Record<string, CareTeamRow[]>>(() =>
    Object.fromEntries(
      cases.map((careCase) => [
        careCase.id,
        careCase.care_team_links.map((link) => ({
          id: link.id,
          role: (['physician', 'nurse', 'care_manager', 'pharmacist', 'other'].includes(link.role)
            ? link.role
            : 'other') as CareTeamRow['role'],
          name: link.name,
          organization_name: link.organization_name ?? '',
          department: link.department ?? '',
          phone: link.phone ?? '',
          email: link.email ?? '',
          fax: link.fax ?? '',
          address: link.address ?? '',
          is_primary: link.is_primary,
          notes: link.notes ?? '',
        })),
      ]),
    ),
  );

  const rows = drafts[selectedCaseId] ?? [];
  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/patients/${patientId}/care-team`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'x-org-id': orgId,
        },
        body: JSON.stringify({
          case_id: selectedCaseId,
          links: rows
            .filter((row) => row.name.trim())
            .map((row) => ({
              role: row.role,
              name: row.name.trim(),
              organization_name: row.organization_name || undefined,
              department: row.department || undefined,
              phone: row.phone || undefined,
              email: row.email || undefined,
              fax: row.fax || undefined,
              address: row.address || undefined,
              is_primary: row.is_primary,
              notes: row.notes || undefined,
            })),
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((payload as { message?: string }).message ?? '多職種連携先の保存に失敗しました');
      }
      return payload;
    },
    onSuccess: async () => {
      toast.success('多職種連携先を更新しました');
      await queryClient.invalidateQueries({ queryKey: ['patient', patientId, orgId] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : '多職種連携先の保存に失敗しました');
    },
  });

  const selectedCase = useMemo(
    () => cases.find((careCase) => careCase.id === selectedCaseId) ?? null,
    [cases, selectedCaseId],
  );

  function updateRows(nextRows: CareTeamRow[]) {
    setDrafts((current) => ({
      ...current,
      [selectedCaseId]: nextRows,
    }));
  }

  if (cases.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">多職種連携先</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          ケース作成後に訪問診療医・訪問看護師・ケアマネジャー等を登録できます。
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">多職種連携先</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm text-muted-foreground">
            {selectedCase ? `ケース ${selectedCase.id.slice(-6).toUpperCase()} / ${selectedCase.status}` : 'ケース未選択'}
          </div>
          <Select value={selectedCaseId} onValueChange={(value) => setSelectedCaseId(value || defaultCaseId)}>
            <SelectTrigger className="sm:w-[240px]">
              <SelectValue placeholder="ケースを選択" />
            </SelectTrigger>
            <SelectContent>
              {cases.map((careCase) => (
                <SelectItem key={careCase.id} value={careCase.id}>
                  ケース {careCase.id.slice(-6).toUpperCase()}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-3">
          {rows.map((row, index) => (
            <div key={row.id ?? `care-team-${index}`} className="rounded-lg border p-3">
              <div className="grid gap-3 md:grid-cols-2">
                <Field label="役割">
                  <Select
                    value={row.role}
                    onValueChange={(value) =>
                      updateRows(
                        rows.map((item, itemIndex) =>
                          itemIndex === index ? { ...item, role: value as CareTeamRow['role'] } : item,
                        ),
                      )
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(roleLabel).map(([value, label]) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="氏名">
                  <Input
                    value={row.name}
                    onChange={(event) =>
                      updateRows(
                        rows.map((item, itemIndex) =>
                          itemIndex === index ? { ...item, name: event.target.value } : item,
                        ),
                      )
                    }
                  />
                </Field>
                <Field label="所属">
                  <Input
                    value={row.organization_name}
                    onChange={(event) =>
                      updateRows(
                        rows.map((item, itemIndex) =>
                          itemIndex === index
                            ? { ...item, organization_name: event.target.value }
                            : item,
                        ),
                      )
                    }
                  />
                </Field>
                <Field label="部署">
                  <Input
                    value={row.department}
                    onChange={(event) =>
                      updateRows(
                        rows.map((item, itemIndex) =>
                          itemIndex === index ? { ...item, department: event.target.value } : item,
                        ),
                      )
                    }
                  />
                </Field>
                <Field label="電話番号">
                  <Input
                    value={row.phone}
                    onChange={(event) =>
                      updateRows(
                        rows.map((item, itemIndex) =>
                          itemIndex === index ? { ...item, phone: event.target.value } : item,
                        ),
                      )
                    }
                  />
                </Field>
                <Field label="メール">
                  <Input
                    value={row.email}
                    onChange={(event) =>
                      updateRows(
                        rows.map((item, itemIndex) =>
                          itemIndex === index ? { ...item, email: event.target.value } : item,
                        ),
                      )
                    }
                  />
                </Field>
                <Field label="FAX">
                  <Input
                    value={row.fax}
                    onChange={(event) =>
                      updateRows(
                        rows.map((item, itemIndex) =>
                          itemIndex === index ? { ...item, fax: event.target.value } : item,
                        ),
                      )
                    }
                  />
                </Field>
                <Field label="住所">
                  <Input
                    value={row.address}
                    onChange={(event) =>
                      updateRows(
                        rows.map((item, itemIndex) =>
                          itemIndex === index ? { ...item, address: event.target.value } : item,
                        ),
                      )
                    }
                  />
                </Field>
                <Field label="連絡メモ" className="md:col-span-2">
                  <Textarea
                    rows={2}
                    value={row.notes}
                    onChange={(event) =>
                      updateRows(
                        rows.map((item, itemIndex) =>
                          itemIndex === index ? { ...item, notes: event.target.value } : item,
                        ),
                      )
                    }
                  />
                </Field>
              </div>

              <div className="mt-3 flex items-center justify-between gap-3">
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={row.is_primary}
                    onCheckedChange={(checked) =>
                      updateRows(
                        rows.map((item, itemIndex) =>
                          itemIndex === index ? { ...item, is_primary: Boolean(checked) } : item,
                        ),
                      )
                    }
                  />
                  <span>主要担当</span>
                </label>

                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => updateRows(rows.filter((_, itemIndex) => itemIndex !== index))}
                >
                  <Trash2 className="mr-1 size-4" />
                  削除
                </Button>
              </div>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap justify-between gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() =>
              updateRows([
                ...rows,
                {
                  role: 'physician',
                  name: '',
                  organization_name: '',
                  department: '',
                  phone: '',
                  email: '',
                  fax: '',
                  address: '',
                  is_primary: rows.length === 0,
                  notes: '',
                },
              ])
            }
          >
            <Plus className="mr-1 size-4" />
            行追加
          </Button>
          <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending || !selectedCaseId}>
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
