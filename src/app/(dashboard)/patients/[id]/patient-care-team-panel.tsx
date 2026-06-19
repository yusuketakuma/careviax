'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { ActionRail } from '@/components/ui/action-rail';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
import { careTeamContactBadges, type CareTeamContactBadge } from '@/lib/patient/care-team-contact';
import { getPatientCareQueryKeys, invalidateQueryKeys } from '@/lib/visits/query-invalidations';
import { cn } from '@/lib/utils';

type CareTeamRow = {
  id?: string;
  external_professional_id?: string;
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

type ExternalProfessionalOption = {
  id: string;
  profession_type: string;
  name: string;
  organization_name: string | null;
  department: string | null;
  phone: string | null;
  email: string | null;
  fax: string | null;
  address: string | null;
  notes: string | null;
};

type ExternalProfessionalDraft = {
  profession_type: string;
  name: string;
  organization_name: string;
  department: string;
  phone: string;
  email: string;
  fax: string;
  address: string;
  notes: string;
};

type ReliabilityWarning = {
  code: string;
  severity: 'warning';
  message: string;
};

const roleLabel: Record<CareTeamRow['role'], string> = {
  physician: '訪問診療医',
  nurse: '訪問看護師',
  care_manager: 'ケアマネジャー',
  pharmacist: '担当薬剤師',
  other: 'その他他職種',
};

const CONTACT_BADGE_TONE_CLASSES: Record<CareTeamContactBadge['tone'], string> = {
  alert: 'border-red-200 bg-red-50 text-red-700',
  ok: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  muted: 'border-border bg-muted text-muted-foreground',
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
      external_professional_id?: string | null;
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
  const [quickCreateRowIndex, setQuickCreateRowIndex] = useState<number | null>(null);
  const [quickCreateDraft, setQuickCreateDraft] = useState<ExternalProfessionalDraft>({
    profession_type: 'physician',
    name: '',
    organization_name: '',
    department: '',
    phone: '',
    email: '',
    fax: '',
    address: '',
    notes: '',
  });
  const [drafts, setDrafts] = useState<Record<string, CareTeamRow[]>>(() =>
    Object.fromEntries(
      cases.map((careCase) => [
        careCase.id,
        careCase.care_team_links.map((link) => ({
          id: link.id,
          external_professional_id: link.external_professional_id ?? undefined,
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
  const { data: professionalOptionsResponse } = useQuery({
    queryKey: ['external-professional-options', orgId],
    queryFn: async () => {
      const response = await fetch('/api/admin/external-professionals', {
        headers: { 'x-org-id': orgId },
      });
      if (!response.ok) throw new Error('他職種マスターの取得に失敗しました');
      return response.json() as Promise<{ data: ExternalProfessionalOption[] }>;
    },
    enabled: !!orgId,
  });
  const professionalOptions = professionalOptionsResponse?.data ?? [];

  const quickCreateMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/admin/external-professionals', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-org-id': orgId,
        },
        body: JSON.stringify(quickCreateDraft),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          (payload as { message?: string }).message ?? '他職種マスターの登録に失敗しました',
        );
      }
      return payload as { data: ExternalProfessionalOption };
    },
    onSuccess: async (payload) => {
      toast.success('他職種マスターを登録しました');
      await queryClient.invalidateQueries({ queryKey: ['external-professional-options', orgId] });
      if (quickCreateRowIndex != null) {
        applyExternalProfessional(quickCreateRowIndex, payload.data.id, payload.data);
      }
      setQuickCreateRowIndex(null);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : '他職種マスターの登録に失敗しました');
    },
  });

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
              external_professional_id: row.external_professional_id,
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
        throw new Error(
          (payload as { message?: string }).message ?? '多職種連携先の保存に失敗しました',
        );
      }
      return payload as { warnings?: ReliabilityWarning[] };
    },
    onSuccess: async (payload) => {
      toast.success('多職種連携先を更新しました');
      for (const warning of payload.warnings ?? []) {
        toast.warning(warning.message);
      }
      await invalidateQueryKeys(queryClient, getPatientCareQueryKeys({ orgId, patientId }));
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

  function updateRowAt(index: number, updater: (row: CareTeamRow) => CareTeamRow) {
    updateRows(rows.map((item, itemIndex) => (itemIndex === index ? updater(item) : item)));
  }

  function applyExternalProfessional(
    index: number,
    externalProfessionalId: string,
    selectedProfessionalOverride?: ExternalProfessionalOption,
  ) {
    const selectedProfessional =
      selectedProfessionalOverride ??
      professionalOptions.find((item) => item.id === externalProfessionalId);
    updateRows(
      rows.map((item, itemIndex) => {
        if (itemIndex !== index) return item;
        if (!selectedProfessional) {
          return {
            ...item,
            external_professional_id: undefined,
          };
        }
        return {
          ...item,
          external_professional_id: selectedProfessional.id,
          role: mapProfessionToCareTeamRole(selectedProfessional.profession_type),
          name: selectedProfessional.name,
          organization_name: selectedProfessional.organization_name ?? '',
          department: selectedProfessional.department ?? '',
          phone: selectedProfessional.phone ?? '',
          email: selectedProfessional.email ?? '',
          fax: selectedProfessional.fax ?? '',
          address: selectedProfessional.address ?? '',
          notes: item.notes || selectedProfessional.notes || '',
        };
      }),
    );
  }

  function openQuickCreateDialog(index: number) {
    const row = rows[index];
    setQuickCreateRowIndex(index);
    setQuickCreateDraft({
      profession_type: mapCareTeamRoleToProfession(row.role),
      name: row.name,
      organization_name: row.organization_name,
      department: row.department,
      phone: row.phone,
      email: row.email,
      fax: row.fax,
      address: row.address,
      notes: row.notes,
    });
  }

  if (cases.length === 0) {
    return (
      <Card>
        <CardHeader>
          <h2 className="font-heading text-base leading-snug font-medium">多職種連携先</h2>
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
        <h2 className="font-heading text-base leading-snug font-medium">多職種連携先</h2>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm text-muted-foreground">
            {selectedCase
              ? `ケース ${selectedCase.id.slice(-6).toUpperCase()} / ${selectedCase.status}`
              : 'ケース未選択'}
          </div>
          <Select
            value={selectedCaseId}
            onValueChange={(value) => setSelectedCaseId(value || defaultCaseId)}
          >
            <SelectTrigger className="sm:w-[240px]" aria-label="多職種連携先のケース">
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
              {/* p0_26: 役割+連絡チャネル状態のサマリ(FAX未登録は赤で警告) */}
              <div
                className="mb-3 flex flex-wrap items-center gap-2 border-b border-border/60 pb-2.5"
                data-testid="care-team-contact-summary"
              >
                <span className="text-sm font-semibold text-foreground">
                  {roleLabel[row.role]}
                  {row.name.trim() ? `: ${row.name}` : ''}
                </span>
                {row.is_primary ? (
                  <span className="inline-flex items-center rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                    主担当
                  </span>
                ) : null}
                {careTeamContactBadges(row).map((badge) => (
                  <span
                    key={badge.label}
                    className={cn(
                      'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium',
                      CONTACT_BADGE_TONE_CLASSES[badge.tone],
                    )}
                  >
                    {badge.label}
                  </span>
                ))}
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <Field label="他職種マスター">
                  <Select
                    value={row.external_professional_id ?? 'manual'}
                    onValueChange={(value) =>
                      applyExternalProfessional(index, !value || value === 'manual' ? '' : value)
                    }
                  >
                    <SelectTrigger aria-label={`多職種連携先${index + 1}件目の他職種マスター`}>
                      <SelectValue placeholder="手入力または登録済みから選択" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="manual">手入力</SelectItem>
                      {professionalOptions.map((item) => (
                        <SelectItem key={item.id} value={item.id}>
                          {item.name} /{' '}
                          {item.organization_name ?? professionLabel(item.profession_type)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="役割">
                  <Select
                    value={row.role}
                    onValueChange={(value) =>
                      updateRowAt(index, (item) => ({
                        ...item,
                        role: value as CareTeamRow['role'],
                      }))
                    }
                  >
                    <SelectTrigger aria-label={`多職種連携先${index + 1}件目の役割`}>
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
                    aria-label={`多職種連携先${index + 1}件目の氏名`}
                    list={`external-professional-suggestions-${index}`}
                    value={row.name}
                    onChange={(event) => {
                      const matchedProfessional = professionalOptions.find(
                        (item) => item.name === event.target.value,
                      );
                      if (matchedProfessional) {
                        applyExternalProfessional(
                          index,
                          matchedProfessional.id,
                          matchedProfessional,
                        );
                        return;
                      }
                      updateRowAt(index, (item) => ({
                        ...item,
                        external_professional_id: undefined,
                        name: event.target.value,
                      }));
                    }}
                  />
                  <datalist id={`external-professional-suggestions-${index}`}>
                    {professionalOptions.map((item) => (
                      <option key={item.id} value={item.name}>
                        {item.organization_name ?? professionLabel(item.profession_type)}
                      </option>
                    ))}
                  </datalist>
                </Field>
                <Field label="所属">
                  <Input
                    aria-label={`多職種連携先${index + 1}件目の所属`}
                    value={row.organization_name}
                    onChange={(event) =>
                      updateRowAt(index, (item) => ({
                        ...item,
                        external_professional_id: undefined,
                        organization_name: event.target.value,
                      }))
                    }
                  />
                </Field>
                <Field label="部署">
                  <Input
                    aria-label={`多職種連携先${index + 1}件目の部署`}
                    value={row.department}
                    onChange={(event) =>
                      updateRowAt(index, (item) => ({
                        ...item,
                        external_professional_id: undefined,
                        department: event.target.value,
                      }))
                    }
                  />
                </Field>
                <Field label="電話番号">
                  <Input
                    aria-label={`多職種連携先${index + 1}件目の電話番号`}
                    value={row.phone}
                    onChange={(event) =>
                      updateRowAt(index, (item) => ({
                        ...item,
                        external_professional_id: undefined,
                        phone: event.target.value,
                      }))
                    }
                  />
                </Field>
                <Field label="メール">
                  <Input
                    aria-label={`多職種連携先${index + 1}件目のメール`}
                    value={row.email}
                    onChange={(event) =>
                      updateRowAt(index, (item) => ({
                        ...item,
                        external_professional_id: undefined,
                        email: event.target.value,
                      }))
                    }
                  />
                </Field>
                <Field label="FAX">
                  <Input
                    aria-label={`多職種連携先${index + 1}件目のFAX`}
                    value={row.fax}
                    onChange={(event) =>
                      updateRowAt(index, (item) => ({
                        ...item,
                        external_professional_id: undefined,
                        fax: event.target.value,
                      }))
                    }
                  />
                </Field>
                <Field label="住所">
                  <Input
                    aria-label={`多職種連携先${index + 1}件目の住所`}
                    value={row.address}
                    onChange={(event) =>
                      updateRowAt(index, (item) => ({
                        ...item,
                        external_professional_id: undefined,
                        address: event.target.value,
                      }))
                    }
                  />
                </Field>
                <Field label="連絡メモ" className="md:col-span-2">
                  <Textarea
                    aria-label={`多職種連携先${index + 1}件目の連絡メモ`}
                    rows={2}
                    value={row.notes}
                    onChange={(event) =>
                      updateRowAt(index, (item) => ({
                        ...item,
                        external_professional_id: undefined,
                        notes: event.target.value,
                      }))
                    }
                  />
                </Field>
              </div>

              <div className="mt-3 flex items-center justify-between gap-3">
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={row.is_primary}
                    onCheckedChange={(checked) =>
                      updateRowAt(index, (item) => ({ ...item, is_primary: Boolean(checked) }))
                    }
                  />
                  <span>主要担当</span>
                </label>

                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => openQuickCreateDialog(index)}
                  >
                    新規登録
                  </Button>
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
            </div>
          ))}
        </div>

        <ActionRail align="between">
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                updateRows([
                  ...rows,
                  {
                    role: 'physician',
                    external_professional_id: undefined,
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
            <Button
              type="button"
              variant="secondary"
              onClick={() =>
                window.open('/admin/external-professionals', '_blank', 'noopener,noreferrer')
              }
            >
              他職種マスターを開く
            </Button>
          </div>
          <Button
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending || !selectedCaseId}
          >
            {saveMutation.isPending ? '保存中...' : '保存'}
          </Button>
        </ActionRail>
      </CardContent>

      <Dialog
        open={quickCreateRowIndex != null}
        onOpenChange={(open) => (!open ? setQuickCreateRowIndex(null) : null)}
      >
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>他職種マスターに追加</DialogTitle>
            <DialogDescription>
              入力中の連携先をマスター登録し、この行へ自動反映します。
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="職種" htmlFor="care-team-quick-create-profession">
              <Select
                value={quickCreateDraft.profession_type}
                onValueChange={(value) =>
                  setQuickCreateDraft((current) => ({
                    ...current,
                    profession_type: value ?? current.profession_type,
                  }))
                }
              >
                <SelectTrigger id="care-team-quick-create-profession">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PROFESSION_OPTIONS.map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="氏名">
              <Input
                aria-label="他職種マスター追加の氏名"
                value={quickCreateDraft.name}
                onChange={(event) =>
                  setQuickCreateDraft((current) => ({ ...current, name: event.target.value }))
                }
              />
            </Field>
            <Field label="所属">
              <Input
                aria-label="他職種マスター追加の所属"
                value={quickCreateDraft.organization_name}
                onChange={(event) =>
                  setQuickCreateDraft((current) => ({
                    ...current,
                    organization_name: event.target.value,
                  }))
                }
              />
            </Field>
            <Field label="部署">
              <Input
                aria-label="他職種マスター追加の部署"
                value={quickCreateDraft.department}
                onChange={(event) =>
                  setQuickCreateDraft((current) => ({ ...current, department: event.target.value }))
                }
              />
            </Field>
            <Field label="電話">
              <Input
                aria-label="他職種マスター追加の電話"
                value={quickCreateDraft.phone}
                onChange={(event) =>
                  setQuickCreateDraft((current) => ({ ...current, phone: event.target.value }))
                }
              />
            </Field>
            <Field label="メール">
              <Input
                aria-label="他職種マスター追加のメール"
                value={quickCreateDraft.email}
                onChange={(event) =>
                  setQuickCreateDraft((current) => ({ ...current, email: event.target.value }))
                }
              />
            </Field>
            <Field label="FAX">
              <Input
                aria-label="他職種マスター追加のFAX"
                value={quickCreateDraft.fax}
                onChange={(event) =>
                  setQuickCreateDraft((current) => ({ ...current, fax: event.target.value }))
                }
              />
            </Field>
            <Field label="住所">
              <Input
                aria-label="他職種マスター追加の住所"
                value={quickCreateDraft.address}
                onChange={(event) =>
                  setQuickCreateDraft((current) => ({ ...current, address: event.target.value }))
                }
              />
            </Field>
            <Field label="メモ" className="md:col-span-2">
              <Textarea
                aria-label="他職種マスター追加のメモ"
                rows={3}
                value={quickCreateDraft.notes}
                onChange={(event) =>
                  setQuickCreateDraft((current) => ({ ...current, notes: event.target.value }))
                }
              />
            </Field>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setQuickCreateRowIndex(null)}>
              キャンセル
            </Button>
            <Button
              type="button"
              onClick={() => quickCreateMutation.mutate()}
              disabled={quickCreateMutation.isPending}
            >
              {quickCreateMutation.isPending ? '登録中...' : '登録して反映'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
  return (
    <div className={className}>
      <Label htmlFor={htmlFor} className="mb-1.5 block">
        {label}
      </Label>
      {children}
    </div>
  );
}

function professionLabel(value: string) {
  switch (value) {
    case 'physician':
      return '医師';
    case 'nurse':
      return '看護師';
    case 'care_manager':
      return 'ケアマネジャー';
    case 'medical_social_worker':
      return '医療ソーシャルワーカー';
    case 'physical_therapist':
      return '理学療法士';
    case 'occupational_therapist':
      return '作業療法士';
    case 'speech_therapist':
      return '言語聴覚士';
    case 'registered_dietitian':
      return '管理栄養士';
    case 'dentist':
      return '歯科医師';
    case 'dental_hygienist':
      return '歯科衛生士';
    case 'home_helper':
      return 'ホームヘルパー';
    case 'care_staff':
      return '介護職';
    default:
      return 'その他';
  }
}

function mapProfessionToCareTeamRole(value: string): CareTeamRow['role'] {
  switch (value) {
    case 'physician':
      return 'physician';
    case 'nurse':
      return 'nurse';
    case 'care_manager':
      return 'care_manager';
    default:
      return 'other';
  }
}

const PROFESSION_OPTIONS = [
  ['physician', '医師'],
  ['nurse', '看護師'],
  ['care_manager', 'ケアマネジャー'],
  ['medical_social_worker', '医療ソーシャルワーカー'],
  ['physical_therapist', '理学療法士'],
  ['occupational_therapist', '作業療法士'],
  ['speech_therapist', '言語聴覚士'],
  ['registered_dietitian', '管理栄養士'],
  ['dentist', '歯科医師'],
  ['dental_hygienist', '歯科衛生士'],
  ['home_helper', 'ホームヘルパー'],
  ['care_staff', '介護職'],
  ['other', 'その他'],
] as const;

function mapCareTeamRoleToProfession(value: CareTeamRow['role']) {
  switch (value) {
    case 'physician':
      return 'physician';
    case 'nurse':
      return 'nurse';
    case 'care_manager':
      return 'care_manager';
    default:
      return 'other';
  }
}
