'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type ColumnDef } from '@tanstack/react-table';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DataTable } from '@/components/ui/data-table';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  CONTACT_METHOD_OPTIONS,
  contactMethodLabel,
  type ContactProfileKind,
} from '@/lib/contact-profiles';
import { useOrgId } from '@/lib/hooks/use-org-id';

type ContactProfile = {
  id: string;
  kind: ContactProfileKind;
  name: string;
  subtitle: string | null;
  phone: string | null;
  email: string | null;
  fax: string | null;
  preferred_contact_method: string | null;
  preferred_contact_time: string | null;
  last_contacted_at: string | null;
  last_success_channel: string | null;
  recommended_channels: string[];
  active_patient_count: number;
  pending_response_count: number;
};

const KIND_LABELS: Record<ContactProfile['kind'], string> = {
  facility_contact: '施設担当者',
  external_professional: '他職種',
  prescriber_institution: '医療機関',
};

function labelOf(value: string | null) {
  return contactMethodLabel(value);
}

type ContactForm = {
  name: string;
  contactPerson: string;
  phone: string;
  fax: string;
  email: string;
  preferred_contact_method: string;
};

const NONE_METHOD = 'none';

function toForm(profile: ContactProfile): ContactForm {
  return {
    name: profile.name,
    contactPerson: profile.subtitle ?? '',
    phone: profile.phone ?? '',
    fax: profile.fax ?? '',
    email: profile.email ?? '',
    preferred_contact_method: profile.preferred_contact_method ?? NONE_METHOD,
  };
}

export function ContactProfilesContent() {
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  const [kind, setKind] = useState<'all' | ContactProfile['kind']>('all');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // フォーム編集状態。選択した連絡先 id を保持し、選択が変わったら描画中に再初期化する
  const [editState, setEditState] = useState<{ id: string; form: ContactForm } | null>(null);

  const profilesQuery = useQuery({
    queryKey: ['contact-profiles', orgId, kind, query],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (kind !== 'all') params.set('kind', kind);
      if (query.trim()) params.set('q', query.trim());
      const response = await fetch(`/api/contact-profiles?${params.toString()}`, {
        headers: { 'x-org-id': orgId },
      });
      if (!response.ok) throw new Error('連携先プロファイルの取得に失敗しました');
      return response.json() as Promise<{ data: ContactProfile[] }>;
    },
    enabled: !!orgId,
  });

  const rows = useMemo(() => profilesQuery.data?.data ?? [], [profilesQuery.data]);

  const selected = useMemo(
    () => rows.find((row) => row.id === selectedId) ?? null,
    [rows, selectedId],
  );

  // 選択が切り替わったら描画中にフォームを再初期化（effect での setState を避ける）
  if (selected && editState?.id !== selected.id) {
    setEditState({ id: selected.id, form: toForm(selected) });
  } else if (!selected && editState) {
    setEditState(null);
  }
  const form = selected && editState?.id === selected.id ? editState.form : null;
  const setForm = (updater: (prev: ContactForm) => ContactForm) => {
    setEditState((prev) => (prev ? { ...prev, form: updater(prev.form) } : prev));
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!selected || !form) throw new Error('編集対象が選択されていません');
      const response = await fetch('/api/contact-profiles', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'x-org-id': orgId,
        },
        body: JSON.stringify({
          kind: selected.kind,
          id: selected.id,
          name: form.name.trim(),
          ...(selected.kind === 'facility_contact'
            ? { role: form.contactPerson.trim() || null }
            : {}),
          ...(selected.kind === 'external_professional'
            ? { department: form.contactPerson.trim() || null }
            : {}),
          phone: form.phone.trim() || null,
          fax: form.fax.trim() || null,
          ...(selected.kind !== 'prescriber_institution'
            ? { email: form.email.trim() || null }
            : {}),
          preferred_contact_method:
            form.preferred_contact_method === NONE_METHOD
              ? null
              : form.preferred_contact_method,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error((payload as { message?: string }).message ?? '保存に失敗しました');
      }
      return payload;
    },
    onSuccess: async () => {
      toast.success('連絡先を保存しました');
      await queryClient.invalidateQueries({ queryKey: ['contact-profiles', orgId] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : '保存に失敗しました');
    },
  });

  const columns = useMemo<ColumnDef<ContactProfile>[]>(
    () => [
      {
        accessorKey: 'name',
        header: '連携先',
        cell: ({ row }) => (
          <button
            type="button"
            className="space-y-1 text-left"
            onClick={() => setSelectedId(row.original.id)}
          >
            <div className="font-medium">{row.original.name}</div>
            <div className="text-xs text-muted-foreground">
              {row.original.subtitle ?? KIND_LABELS[row.original.kind]}
            </div>
          </button>
        ),
      },
      {
        accessorKey: 'kind',
        header: '種別',
        cell: ({ row }) => <Badge variant="outline">{KIND_LABELS[row.original.kind]}</Badge>,
      },
      {
        id: 'contact',
        header: '既定連絡',
        cell: ({ row }) => (
          <div className="space-y-1 text-xs text-muted-foreground">
            <div>{labelOf(row.original.preferred_contact_method)}</div>
            <div>{row.original.preferred_contact_time ?? '時間帯未設定'}</div>
          </div>
        ),
      },
      {
        id: 'learning',
        header: '学習状況',
        cell: ({ row }) => (
          <div className="space-y-1 text-xs text-muted-foreground">
            <div>
              成功チャネル {row.original.last_success_channel ? labelOf(row.original.last_success_channel) : 'なし'}
            </div>
            <div>
              最終連絡 {row.original.last_contacted_at ? new Date(row.original.last_contacted_at).toLocaleString('ja-JP') : 'なし'}
            </div>
            <div>
              推奨順{' '}
              {row.original.recommended_channels.length > 0
                ? row.original.recommended_channels.map((channel) => labelOf(channel)).join(' → ')
                : '未学習'}
            </div>
          </div>
        ),
      },
      {
        accessorKey: 'active_patient_count',
        header: '関連患者',
        cell: ({ row }) => `${row.original.active_patient_count}名`,
      },
      {
        accessorKey: 'pending_response_count',
        header: '未完了連携',
        cell: ({ row }) => `${row.original.pending_response_count}件`,
      },
    ],
    []
  );

  const contactPersonLabel =
    selected?.kind === 'external_professional' ? '部署' : '担当者';
  const showContactPerson = selected?.kind !== 'prescriber_institution';
  const showEmail = selected?.kind !== 'prescriber_institution';

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">検索・フィルタ</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-[220px_minmax(0,1fr)]">
          <div className="space-y-1.5">
            <Label>種別</Label>
            <Select value={kind} onValueChange={(value) => setKind(value as typeof kind)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">すべて</SelectItem>
                <SelectItem value="facility_contact">施設担当者</SelectItem>
                <SelectItem value="external_professional">他職種</SelectItem>
                <SelectItem value="prescriber_institution">医療機関</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>検索</Label>
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="氏名・所属・電話・FAX・メール"
            />
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">送付先一覧</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <DataTable columns={columns} data={rows} isLoading={profilesQuery.isLoading} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">連絡先の編集</CardTitle>
          </CardHeader>
          <CardContent>
            {!selected || !form ? (
              <p className="text-sm text-muted-foreground">
                左の一覧から送付先を選択すると、連絡先を編集できます。
              </p>
            ) : (
              <form
                className="space-y-5"
                onSubmit={(event) => {
                  event.preventDefault();
                  saveMutation.mutate();
                }}
              >
                <div className="space-y-1.5">
                  <Label htmlFor="contact-name">宛先</Label>
                  <Input
                    id="contact-name"
                    value={form.name}
                    onChange={(event) =>
                      setForm((prev) => ({ ...prev, name: event.target.value }))
                    }
                    placeholder="送付先の名称"
                  />
                </div>

                {showContactPerson && (
                  <div className="space-y-1.5">
                    <Label htmlFor="contact-person">{contactPersonLabel}</Label>
                    <Input
                      id="contact-person"
                      value={form.contactPerson}
                      onChange={(event) =>
                        setForm((prev) => ({ ...prev, contactPerson: event.target.value }))
                      }
                      placeholder={contactPersonLabel}
                    />
                  </div>
                )}

                <div className="space-y-1.5">
                  <Label htmlFor="contact-fax">FAX</Label>
                  <Input
                    id="contact-fax"
                    value={form.fax}
                    onChange={(event) =>
                      setForm((prev) => ({ ...prev, fax: event.target.value }))
                    }
                    placeholder="03-1234-5678"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="contact-phone">電話</Label>
                  <Input
                    id="contact-phone"
                    value={form.phone}
                    onChange={(event) =>
                      setForm((prev) => ({ ...prev, phone: event.target.value }))
                    }
                    placeholder="03-1234-1111"
                  />
                </div>

                {showEmail && (
                  <div className="space-y-1.5">
                    <Label htmlFor="contact-email">メール</Label>
                    <Input
                      id="contact-email"
                      type="email"
                      value={form.email}
                      onChange={(event) =>
                        setForm((prev) => ({ ...prev, email: event.target.value }))
                      }
                      placeholder="contact@example.com"
                    />
                  </div>
                )}

                <div className="space-y-1.5">
                  <Label>送付方法</Label>
                  <Select
                    value={form.preferred_contact_method}
                    onValueChange={(value) =>
                      setForm((prev) => ({
                        ...prev,
                        preferred_contact_method: value ?? NONE_METHOD,
                      }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="送付方法を選択" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE_METHOD}>未設定</SelectItem>
                      {CONTACT_METHOD_OPTIONS.map((method) => (
                        <SelectItem key={method} value={method}>
                          {contactMethodLabel(method)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="pt-2">
                  <Button type="submit" disabled={saveMutation.isPending}>
                    {saveMutation.isPending ? '保存中…' : '保存する'}
                  </Button>
                </div>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
