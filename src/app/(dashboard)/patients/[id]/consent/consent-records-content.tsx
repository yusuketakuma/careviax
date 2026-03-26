'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { type ColumnDef } from '@tanstack/react-table';
import { format, parseISO, differenceInDays } from 'date-fns';
import { ja } from 'date-fns/locale';
import { Plus, ShieldOff } from 'lucide-react';
import { toast } from 'sonner';
import { DataTable } from '@/components/ui/data-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useOrgId } from '@/lib/hooks/use-org-id';

// --- Types ---

type ConsentRecord = {
  id: string;
  patient_id: string;
  consent_type: string;
  method: string;
  obtained_date: string;
  expiry_date: string | null;
  revoked_date: string | null;
  is_active: boolean;
  access_restricted: boolean;
  created_at: string;
};

type ConsentListResponse = {
  data: ConsentRecord[];
  hasMore: boolean;
  totalCount: number;
};

// --- Constants ---

const CONSENT_TYPE_LABELS: Record<string, string> = {
  visit_medication_management: '訪問薬剤管理',
  personal_info_handling: '個人情報取扱',
  external_sharing: '外部共有',
  photo_capture: '写真撮影',
};

const METHOD_LABELS: Record<string, string> = {
  paper_scan: '紙署名スキャン',
  digital: 'デジタル',
};

function getConsentStatus(record: ConsentRecord): 'active' | 'revoked' | 'expired' {
  if (!record.is_active && record.revoked_date) return 'revoked';
  if (record.expiry_date && new Date(record.expiry_date) < new Date()) return 'expired';
  return 'active';
}

// --- Columns ---

function useColumns(onRevoke: (record: ConsentRecord) => void): ColumnDef<ConsentRecord>[] {
  return [
    {
      accessorKey: 'consent_type',
      header: '同意種別',
      cell: ({ row }) => (
        <span className="font-medium">
          {CONSENT_TYPE_LABELS[row.original.consent_type] ?? row.original.consent_type}
        </span>
      ),
    },
    {
      accessorKey: 'method',
      header: '取得方法',
      cell: ({ row }) => (
        <span className="text-sm">
          {METHOD_LABELS[row.original.method] ?? row.original.method}
        </span>
      ),
    },
    {
      accessorKey: 'obtained_date',
      header: '取得日',
      cell: ({ row }) => (
        <span className="text-sm">
          {format(parseISO(row.original.obtained_date), 'yyyy/MM/dd', { locale: ja })}
        </span>
      ),
    },
    {
      accessorKey: 'expiry_date',
      header: '有効期限',
      cell: ({ row }) => {
        const expiryDate = row.original.expiry_date;
        if (!expiryDate) return <span className="text-sm text-muted-foreground">—</span>;
        const daysUntilExpiry = differenceInDays(new Date(expiryDate), new Date());
        const isExpiringSoon = daysUntilExpiry >= 0 && daysUntilExpiry <= 30;
        return (
          <span className="flex items-center gap-1.5 text-sm">
            {format(parseISO(expiryDate), 'yyyy/MM/dd', { locale: ja })}
            {isExpiringSoon && (
              <Badge variant="outline" className="border-orange-400 text-orange-600 text-xs">
                {daysUntilExpiry === 0 ? '本日期限' : `${daysUntilExpiry}日後`}
              </Badge>
            )}
          </span>
        );
      },
    },
    {
      id: 'status',
      header: 'ステータス',
      cell: ({ row }) => {
        const status = getConsentStatus(row.original);
        if (status === 'active') {
          return <Badge variant="default">有効</Badge>;
        }
        if (status === 'revoked') {
          return <Badge variant="destructive">撤回済</Badge>;
        }
        return <Badge variant="outline">期限切れ</Badge>;
      },
    },
    {
      id: 'actions',
      header: '操作',
      cell: ({ row }) => {
        const status = getConsentStatus(row.original);
        if (status !== 'active') return null;
        return (
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 text-destructive hover:text-destructive"
            onClick={() => onRevoke(row.original)}
          >
            <ShieldOff className="h-3.5 w-3.5" />
            撤回
          </Button>
        );
      },
    },
  ];
}

// --- Create Dialog ---

type CreateFormState = {
  consent_type: string;
  method: string;
  obtained_date: string;
  expiry_date: string;
  document_url: string;
};

function CreateConsentDialog({
  patientId,
  orgId,
  onClose,
}: {
  patientId: string;
  orgId: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<CreateFormState>({
    consent_type: '',
    method: 'paper_scan',
    obtained_date: format(new Date(), 'yyyy-MM-dd'),
    expiry_date: '',
    document_url: '',
  });

  const mutation = useMutation({
    mutationFn: async (data: CreateFormState) => {
      const res = await fetch('/api/consent-records', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-org-id': orgId },
        body: JSON.stringify({
          patient_id: patientId,
          consent_type: data.consent_type,
          method: data.method,
          obtained_date: data.obtained_date,
          ...(data.expiry_date ? { expiry_date: data.expiry_date } : {}),
          ...(data.document_url ? { document_url: data.document_url } : {}),
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message ?? '同意記録の登録に失敗しました');
      }
      return res.json();
    },
    onSuccess: () => {
      toast.success('同意記録を登録しました');
      queryClient.invalidateQueries({ queryKey: ['consent-records', patientId] });
      onClose();
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.consent_type) {
      toast.error('同意種別を選択してください');
      return;
    }
    if (!form.obtained_date) {
      toast.error('取得日を入力してください');
      return;
    }
    mutation.mutate(form);
  };

  return (
    <DialogContent className="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>新規同意取得</DialogTitle>
      </DialogHeader>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="consent_type">同意種別 <span className="text-destructive">*</span></Label>
          <Select
            value={form.consent_type}
            onValueChange={(v) => setForm((f) => ({ ...f, consent_type: v ?? f.consent_type }))}
          >
            <SelectTrigger id="consent_type">
              <SelectValue placeholder="選択してください" />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(CONSENT_TYPE_LABELS).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label>取得方法 <span className="text-destructive">*</span></Label>
          <div className="flex gap-4">
            {(['paper_scan', 'digital'] as const).map((m) => (
              <label key={m} className="flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="method"
                  value={m}
                  checked={form.method === m}
                  onChange={() => setForm((f) => ({ ...f, method: m }))}
                  className="accent-primary"
                />
                {METHOD_LABELS[m]}
              </label>
            ))}
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="obtained_date">取得日 <span className="text-destructive">*</span></Label>
          <Input
            id="obtained_date"
            type="date"
            value={form.obtained_date}
            onChange={(e) => setForm((f) => ({ ...f, obtained_date: e.target.value }))}
            required
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="expiry_date">有効期限（任意）</Label>
          <Input
            id="expiry_date"
            type="date"
            value={form.expiry_date}
            onChange={(e) => setForm((f) => ({ ...f, expiry_date: e.target.value }))}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="document_url">文書URL（任意）</Label>
          <Input
            id="document_url"
            type="url"
            placeholder="https://..."
            value={form.document_url}
            onChange={(e) => setForm((f) => ({ ...f, document_url: e.target.value }))}
          />
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={mutation.isPending}>
            キャンセル
          </Button>
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? '登録中...' : '登録'}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}

// --- Revoke Dialog ---

function RevokeConsentDialog({
  record,
  orgId,
  onClose,
}: {
  record: ConsentRecord;
  orgId: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [reason, setReason] = useState('');
  const [confirmed, setConfirmed] = useState(false);

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/consent-records/${record.id}/revoke`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-org-id': orgId },
        body: JSON.stringify({ reason: reason || undefined }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message ?? '同意撤回に失敗しました');
      }
      return res.json();
    },
    onSuccess: () => {
      toast.success('同意を撤回しました');
      queryClient.invalidateQueries({ queryKey: ['consent-records', record.patient_id] });
      onClose();
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });

  return (
    <DialogContent className="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>同意撤回の確認</DialogTitle>
      </DialogHeader>
      <div className="space-y-4">
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          <p className="font-medium">撤回による影響</p>
          <ul className="mt-1.5 list-inside list-disc space-y-1 text-sm">
            <li>この同意記録は無効化されます</li>
            <li>患者の外部共有アクセスがすべて無効化されます</li>
            <li>ケース継続の判断が必要となります（ワークフロー例外が作成されます）</li>
          </ul>
        </div>

        <p className="text-sm text-muted-foreground">
          対象:{' '}
          <span className="font-medium text-foreground">
            {CONSENT_TYPE_LABELS[record.consent_type] ?? record.consent_type}
          </span>
        </p>

        <div className="space-y-1.5">
          <Label htmlFor="revoke_reason">撤回理由（任意）</Label>
          <Textarea
            id="revoke_reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="撤回の理由を入力してください..."
            rows={3}
          />
        </div>

        <div className="flex items-start gap-2">
          <Checkbox
            id="revoke_confirm"
            checked={confirmed}
            onCheckedChange={(v) => setConfirmed(v === true)}
          />
          <label
            htmlFor="revoke_confirm"
            className="cursor-pointer text-sm leading-snug"
          >
            この操作は取り消せません
          </label>
        </div>
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose} disabled={mutation.isPending}>
          キャンセル
        </Button>
        <Button
          type="button"
          variant="destructive"
          disabled={!confirmed || mutation.isPending}
          onClick={() => mutation.mutate()}
        >
          {mutation.isPending ? '処理中...' : '撤回する'}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

// --- Main Component ---

export function ConsentRecordsContent() {
  const params = useParams();
  const patientId = params.id as string;
  const orgId = useOrgId();

  const [createOpen, setCreateOpen] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<ConsentRecord | null>(null);

  const { data, isLoading } = useQuery<ConsentListResponse>({
    queryKey: ['consent-records', patientId],
    queryFn: async () => {
      const res = await fetch(
        `/api/consent-records?patient_id=${patientId}&is_active=false`,
        { headers: { 'x-org-id': orgId } }
      );
      if (!res.ok) throw new Error('同意記録の取得に失敗しました');
      return res.json();
    },
    enabled: !!orgId && !!patientId,
  });

  const columns = useColumns((record) => setRevokeTarget(record));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">同意記録</h2>
        <Button size="sm" className="gap-1.5" onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" />
          新規同意取得
        </Button>
      </div>

      <DataTable
        columns={columns}
        data={data?.data ?? []}
        isLoading={isLoading}
        caption="患者の同意記録一覧"
      />

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        {createOpen && (
          <CreateConsentDialog
            patientId={patientId}
            orgId={orgId}
            onClose={() => setCreateOpen(false)}
          />
        )}
      </Dialog>

      <Dialog open={!!revokeTarget} onOpenChange={(open) => !open && setRevokeTarget(null)}>
        {revokeTarget && (
          <RevokeConsentDialog
            record={revokeTarget}
            orgId={orgId}
            onClose={() => setRevokeTarget(null)}
          />
        )}
      </Dialog>
    </div>
  );
}
