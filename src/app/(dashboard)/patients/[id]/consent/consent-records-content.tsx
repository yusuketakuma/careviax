'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { type ColumnDef } from '@tanstack/react-table';
import { format, parseISO, differenceInDays } from 'date-fns';
import { ja } from 'date-fns/locale';
import { FileText, Pencil, Plus, ShieldOff, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { DataTable } from '@/components/ui/data-table';
import { Badge } from '@/components/ui/badge';
import { StateBadge } from '@/components/ui/state-badge';
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
import { getPatientCareQueryKeys, invalidateQueryKeys } from '@/lib/visits/query-invalidations';

// --- Types ---

type ConsentRecord = {
  id: string;
  patient_id: string;
  template_id: string | null;
  template_version: number | null;
  template: {
    id: string;
    name: string;
    version: number;
  } | null;
  consent_type: string;
  method: string;
  obtained_date: string;
  expiry_date: string | null;
  revoked_date: string | null;
  document_url: string | null;
  has_document_url: boolean;
  document_url_redacted: boolean;
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

const CONSENT_DOCUMENT_ACCEPT = 'application/pdf,image/jpeg,image/png,image/webp';

function inferConsentDocumentMimeType(file: File) {
  if (file.type) return file.type;
  const lowerName = file.name.toLowerCase();
  if (lowerName.endsWith('.jpg') || lowerName.endsWith('.jpeg')) return 'image/jpeg';
  if (lowerName.endsWith('.png')) return 'image/png';
  if (lowerName.endsWith('.webp')) return 'image/webp';
  return 'application/pdf';
}

function getConsentStatus(record: ConsentRecord): 'active' | 'revoked' | 'expired' {
  if (!record.is_active && record.revoked_date) return 'revoked';
  if (record.expiry_date && new Date(record.expiry_date) < new Date()) return 'expired';
  return 'active';
}

function toDateInputValue(value: string | null) {
  if (!value) return '';
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return trimmed.slice(0, 10);
  return '';
}

// --- Columns ---

function useColumns(args: {
  onEdit: (record: ConsentRecord) => void;
  onRevoke: (record: ConsentRecord) => void;
}): ColumnDef<ConsentRecord>[] {
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
      id: 'template',
      header: 'テンプレート',
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">
          {row.original.template
            ? `${row.original.template.name} v${row.original.template.version}`
            : row.original.template_version != null
              ? `v${row.original.template_version}`
              : '—'}
        </span>
      ),
    },
    {
      accessorKey: 'method',
      header: '取得方法',
      cell: ({ row }) => (
        <span className="text-sm">{METHOD_LABELS[row.original.method] ?? row.original.method}</span>
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
              <StateBadge role="confirm" className="text-xs">
                {daysUntilExpiry === 0 ? '本日期限' : `${daysUntilExpiry}日後`}
              </StateBadge>
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
      id: 'document',
      header: '同意書',
      cell: ({ row }) => {
        const record = row.original;
        if (record.document_url) {
          return (
            <Button asChild variant="outline" size="sm" className="gap-1.5">
              <a href={record.document_url} target="_blank" rel="noreferrer">
                <FileText className="h-3.5 w-3.5" />
                閲覧
              </a>
            </Button>
          );
        }
        if (record.document_url_redacted) {
          return (
            <Badge variant="outline" className="text-xs">
              旧URL非表示
            </Badge>
          );
        }
        return <span className="text-sm text-muted-foreground">なし</span>;
      },
    },
    {
      id: 'actions',
      header: '操作',
      cell: ({ row }) => {
        const status = getConsentStatus(row.original);
        if (status !== 'active') return null;
        return (
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => args.onEdit(row.original)}
            >
              <Pencil className="h-3.5 w-3.5" />
              更新
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 text-destructive hover:text-destructive"
              onClick={() => args.onRevoke(row.original)}
            >
              <ShieldOff className="h-3.5 w-3.5" />
              撤回
            </Button>
          </div>
        );
      },
    },
  ];
}

// --- Create Dialog ---

type CreateFormState = {
  template_id: string;
  consent_type: string;
  method: string;
  obtained_date: string;
  expiry_date: string;
  document_file: File | null;
};

type CreateFormErrors = {
  consentType?: string;
  obtainedDate?: string;
};

async function uploadConsentDocument(args: { file: File; patientId: string; orgId: string }) {
  const presignResponse = await fetch('/api/files/presigned-upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-org-id': args.orgId },
    body: JSON.stringify({
      purpose: 'consent-document',
      patient_id: args.patientId,
      file_name: args.file.name,
      mime_type: inferConsentDocumentMimeType(args.file),
      size_bytes: args.file.size,
    }),
  });

  const presignJson = await presignResponse.json().catch(() => null);
  if (!presignResponse.ok) {
    throw new Error(presignJson?.message ?? '同意書ファイルのアップロードURL取得に失敗しました');
  }

  const uploadResponse = await fetch(presignJson.data.uploadUrl, {
    method: 'PUT',
    headers: presignJson.data.headers,
    body: args.file,
  });
  if (!uploadResponse.ok) {
    throw new Error('同意書ファイルのアップロードに失敗しました');
  }

  const completeResponse = await fetch('/api/files/complete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-org-id': args.orgId },
    body: JSON.stringify({
      file_id: presignJson.data.id,
      etag: uploadResponse.headers.get('etag') ?? undefined,
    }),
  });

  const completeJson = await completeResponse.json().catch(() => null);
  if (!completeResponse.ok) {
    throw new Error(completeJson?.message ?? '同意書ファイルの登録に失敗しました');
  }

  if (typeof completeJson?.data?.id !== 'string') {
    throw new Error('同意書ファイルの登録結果が不正です');
  }

  return completeJson.data.id as string;
}

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
    template_id: '',
    consent_type: '',
    method: 'paper_scan',
    obtained_date: format(new Date(), 'yyyy-MM-dd'),
    expiry_date: '',
    document_file: null,
  });
  const [formErrors, setFormErrors] = useState<CreateFormErrors>({});
  const templatesQuery = useQuery({
    queryKey: ['consent-templates', orgId],
    queryFn: async () => {
      const res = await fetch('/api/templates?template_type=consent_form', {
        headers: { 'x-org-id': orgId },
      });
      if (!res.ok) throw new Error('同意書テンプレートの取得に失敗しました');
      return res.json() as Promise<{
        data: Array<{ id: string; name: string; version: number; is_default: boolean }>;
      }>;
    },
    enabled: !!orgId,
  });

  const mutation = useMutation({
    mutationFn: async (data: CreateFormState) => {
      const documentFileId = data.document_file
        ? await uploadConsentDocument({ file: data.document_file, patientId, orgId })
        : undefined;
      const res = await fetch('/api/consent-records', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-org-id': orgId },
        body: JSON.stringify({
          patient_id: patientId,
          ...(data.template_id ? { template_id: data.template_id } : {}),
          consent_type: data.consent_type,
          method: data.method,
          obtained_date: data.obtained_date,
          ...(data.expiry_date ? { expiry_date: data.expiry_date } : {}),
          ...(documentFileId ? { document_file_id: documentFileId } : {}),
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message ?? '同意記録の登録に失敗しました');
      }
      return res.json();
    },
    onSuccess: async () => {
      toast.success('同意記録を登録しました');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['consent-records', patientId] }),
        invalidateQueryKeys(queryClient, getPatientCareQueryKeys({ orgId, patientId })),
      ]);
      onClose();
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const nextErrors: CreateFormErrors = {};

    if (!form.consent_type) {
      nextErrors.consentType = '同意種別を選択してください';
    }
    if (!form.obtained_date) {
      nextErrors.obtainedDate = '取得日を入力してください';
    }

    setFormErrors(nextErrors);

    const firstError = nextErrors.consentType ?? nextErrors.obtainedDate;
    if (firstError) {
      toast.error(firstError);
      return;
    }

    mutation.mutate(form);
  };

  return (
    <DialogContent className="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>新規同意取得</DialogTitle>
      </DialogHeader>
      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="consent_type">
            同意種別 <span className="text-destructive">*</span>
          </Label>
          <Select
            value={form.consent_type}
            onValueChange={(v) => {
              setForm((f) => ({ ...f, consent_type: v ?? f.consent_type }));
              if (v) setFormErrors((current) => ({ ...current, consentType: undefined }));
            }}
          >
            <SelectTrigger
              id="consent_type"
              aria-invalid={Boolean(formErrors.consentType)}
              aria-describedby={formErrors.consentType ? 'consent-type-error' : undefined}
            >
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
          {formErrors.consentType ? (
            <p id="consent-type-error" role="alert" className="text-xs text-destructive">
              {formErrors.consentType}
            </p>
          ) : null}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="template_id">同意書テンプレート</Label>
          <Select
            value={form.template_id}
            onValueChange={(v) => setForm((f) => ({ ...f, template_id: v ?? '' }))}
          >
            <SelectTrigger id="template_id">
              <SelectValue placeholder="既定テンプレートを使用" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">既定テンプレートを使用</SelectItem>
              {(templatesQuery.data?.data ?? []).map((template) => (
                <SelectItem key={template.id} value={template.id}>
                  {template.name} v{template.version}
                  {template.is_default ? ' / 既定' : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label>
            取得方法 <span className="text-destructive">*</span>
          </Label>
          <div className="flex gap-4">
            {(['paper_scan', 'digital'] as const).map((m) => (
              <label key={m} className="flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="method"
                  value={m}
                  checked={form.method === m}
                  onChange={() => setForm((f) => ({ ...f, method: m }))}
                  className="accent-primary focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                />
                {METHOD_LABELS[m]}
              </label>
            ))}
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="obtained_date">
            取得日 <span className="text-destructive">*</span>
          </Label>
          <Input
            id="obtained_date"
            type="date"
            value={form.obtained_date}
            onChange={(e) => {
              setForm((f) => ({ ...f, obtained_date: e.target.value }));
              if (e.target.value) {
                setFormErrors((current) => ({ ...current, obtainedDate: undefined }));
              }
            }}
            required
            aria-invalid={Boolean(formErrors.obtainedDate)}
            aria-describedby={formErrors.obtainedDate ? 'obtained-date-error' : undefined}
          />
          {formErrors.obtainedDate ? (
            <p id="obtained-date-error" role="alert" className="text-xs text-destructive">
              {formErrors.obtainedDate}
            </p>
          ) : null}
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
          <Label htmlFor="document_file">同意書ファイル（任意）</Label>
          <Input
            id="document_file"
            type="file"
            accept={CONSENT_DOCUMENT_ACCEPT}
            onChange={(e) => setForm((f) => ({ ...f, document_file: e.target.files?.[0] ?? null }))}
          />
          {form.document_file && (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Upload className="h-3 w-3" />
              {form.document_file.name}
            </p>
          )}
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

// --- Edit Dialog ---

type EditFormState = {
  expiry_date: string;
  document_file: File | null;
};

function EditConsentDialog({
  record,
  orgId,
  onClose,
}: {
  record: ConsentRecord;
  orgId: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const originalExpiryDate = toDateInputValue(record.expiry_date);
  const [form, setForm] = useState<EditFormState>({
    expiry_date: originalExpiryDate,
    document_file: null,
  });

  const mutation = useMutation({
    mutationFn: async (data: EditFormState) => {
      const body: { expiry_date?: string | null; document_file_id?: string } = {};
      if (data.expiry_date !== originalExpiryDate) {
        body.expiry_date = data.expiry_date || null;
      }
      if (data.document_file) {
        body.document_file_id = await uploadConsentDocument({
          file: data.document_file,
          patientId: record.patient_id,
          orgId,
        });
      }
      if (Object.keys(body).length === 0) {
        throw new Error('更新内容がありません');
      }

      const res = await fetch(`/api/consent-records/${record.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'x-org-id': orgId },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message ?? '同意記録の更新に失敗しました');
      }
      return res.json();
    },
    onSuccess: async () => {
      toast.success('同意記録を更新しました');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['consent-records', record.patient_id] }),
        invalidateQueryKeys(
          queryClient,
          getPatientCareQueryKeys({ orgId, patientId: record.patient_id }),
        ),
      ]);
      onClose();
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    mutation.mutate(form);
  };

  return (
    <DialogContent className="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>同意記録の更新</DialogTitle>
      </DialogHeader>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="edit_expiry_date">有効期限</Label>
          <Input
            id="edit_expiry_date"
            type="date"
            value={form.expiry_date}
            onChange={(e) => setForm((f) => ({ ...f, expiry_date: e.target.value }))}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="edit_document_file">同意書ファイル差し替え</Label>
          <Input
            id="edit_document_file"
            type="file"
            accept={CONSENT_DOCUMENT_ACCEPT}
            onChange={(e) => setForm((f) => ({ ...f, document_file: e.target.files?.[0] ?? null }))}
          />
          {form.document_file && (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Upload className="h-3 w-3" />
              {form.document_file.name}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={mutation.isPending}>
            キャンセル
          </Button>
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? '更新中...' : '更新'}
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
    onSuccess: async () => {
      toast.success('同意を撤回しました');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['consent-records', record.patient_id] }),
        invalidateQueryKeys(
          queryClient,
          getPatientCareQueryKeys({ orgId, patientId: record.patient_id }),
        ),
      ]);
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
          <label htmlFor="revoke_confirm" className="cursor-pointer text-sm leading-snug">
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
  const [editTarget, setEditTarget] = useState<ConsentRecord | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<ConsentRecord | null>(null);

  const { data, isLoading } = useQuery<ConsentListResponse>({
    queryKey: ['consent-records', patientId],
    queryFn: async () => {
      const res = await fetch(`/api/consent-records?patient_id=${patientId}`, {
        headers: { 'x-org-id': orgId },
      });
      if (!res.ok) throw new Error('同意記録の取得に失敗しました');
      return res.json();
    },
    enabled: !!orgId && !!patientId,
  });

  const columns = useColumns({
    onEdit: (record) => setEditTarget(record),
    onRevoke: (record) => setRevokeTarget(record),
  });

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

      <Dialog open={!!editTarget} onOpenChange={(open) => !open && setEditTarget(null)}>
        {editTarget && (
          <EditConsentDialog
            record={editTarget}
            orgId={orgId}
            onClose={() => setEditTarget(null)}
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
