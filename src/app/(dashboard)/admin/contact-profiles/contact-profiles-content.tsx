'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { type ColumnDef } from '@tanstack/react-table';
import { Badge } from '@/components/ui/badge';
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
import { useOrgId } from '@/lib/hooks/use-org-id';

type ContactProfile = {
  id: string;
  kind: 'facility_contact' | 'external_professional' | 'prescriber_institution';
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

const CONTACT_METHOD_LABELS: Record<string, string> = {
  phone: '電話',
  fax: 'FAX',
  email: 'メール',
  postal: '郵送',
  in_person: '対面',
  ses: 'SESメール',
};

function labelOf(value: string | null) {
  return value ? CONTACT_METHOD_LABELS[value] ?? value : '未設定';
}

export function ContactProfilesContent() {
  const orgId = useOrgId();
  const [kind, setKind] = useState<'all' | ContactProfile['kind']>('all');
  const [query, setQuery] = useState('');

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

  const rows = profilesQuery.data?.data ?? [];

  const columns = useMemo<ColumnDef<ContactProfile>[]>(
    () => [
      {
        accessorKey: 'name',
        header: '連携先',
        cell: ({ row }) => (
          <div className="space-y-1">
            <div className="font-medium">{row.original.name}</div>
            <div className="text-xs text-muted-foreground">
              {row.original.subtitle ?? KIND_LABELS[row.original.kind]}
            </div>
          </div>
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

      <Card>
        <CardHeader>
          <CardTitle className="text-base">連携先一覧</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <DataTable columns={columns} data={rows} isLoading={profilesQuery.isLoading} />
        </CardContent>
      </Card>
    </div>
  );
}
