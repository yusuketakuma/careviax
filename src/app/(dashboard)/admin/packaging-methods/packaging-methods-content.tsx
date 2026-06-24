'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { buildOrgHeaders, buildOrgJsonHeaders } from '@/lib/api/org-headers';
import { encodePathSegment } from '@/lib/http/path-segment';
import { useOrgId } from '@/lib/hooks/use-org-id';

type PackagingMethodRow = {
  id: string;
  name: string;
  description: string | null;
  icon_key: string | null;
  sort_order: number;
  is_active: boolean;
};

const emptyForm = {
  id: '',
  name: '',
  description: '',
  icon_key: '',
  sort_order: '0',
  is_active: true,
};

export function PackagingMethodsContent() {
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  const [form, setForm] = useState(emptyForm);

  const methodsQuery = useQuery({
    queryKey: ['packaging-methods', orgId],
    queryFn: async () => {
      const res = await fetch('/api/packaging-methods', {
        headers: buildOrgHeaders(orgId),
      });
      if (!res.ok) throw new Error('配薬方法マスターの取得に失敗しました');
      return res.json() as Promise<{ data: PackagingMethodRow[] }>;
    },
    enabled: !!orgId,
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const body = {
        name: form.name,
        description: form.description || undefined,
        icon_key: form.icon_key || undefined,
        sort_order: Number(form.sort_order || 0),
        is_active: form.is_active,
      };
      // encodePathSegment runs during URL construction (before fetch), so a dot
      // segment id (e.g. '.') fails closed BEFORE the mutating PATCH side effect.
      const res = await fetch(
        form.id ? `/api/packaging-methods/${encodePathSegment(form.id)}` : '/api/packaging-methods',
        {
          method: form.id ? 'PATCH' : 'POST',
          headers: buildOrgJsonHeaders(orgId),
          body: JSON.stringify(body),
        },
      );
      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error(error.message ?? '配薬方法マスターの保存に失敗しました');
      }
    },
    onSuccess: async () => {
      toast.success(form.id ? '配薬方法を更新しました' : '配薬方法を登録しました');
      setForm(emptyForm);
      await queryClient.invalidateQueries({ queryKey: ['packaging-methods', orgId] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : '配薬方法マスターの保存に失敗しました');
    },
  });

  const methods = methodsQuery.data?.data ?? [];

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(22rem,0.42fr)_minmax(0,1fr)]">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {form.id ? '配薬方法を編集' : '配薬方法を追加'}
          </CardTitle>
          <CardDescription>
            一包化、服薬カレンダー、施設カートなど、セット工程で選ぶ方法を登録します。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="packaging-method-name">名称</Label>
            <Input
              id="packaging-method-name"
              value={form.name}
              onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
              placeholder="例: 一包化 / 施設カレンダー"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="packaging-method-description">説明</Label>
            <Textarea
              id="packaging-method-description"
              rows={3}
              value={form.description}
              onChange={(event) =>
                setForm((current) => ({ ...current, description: event.target.value }))
              }
              placeholder="セット・監査・訪問時に確認するポイント"
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="packaging-method-icon">アイコンキー</Label>
              <Input
                id="packaging-method-icon"
                value={form.icon_key}
                onChange={(event) =>
                  setForm((current) => ({ ...current, icon_key: event.target.value }))
                }
                placeholder="package"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="packaging-method-order">表示順</Label>
              <Input
                id="packaging-method-order"
                type="number"
                min={0}
                value={form.sort_order}
                onChange={(event) =>
                  setForm((current) => ({ ...current, sort_order: event.target.value }))
                }
              />
            </div>
          </div>
          <label className="flex items-center justify-between gap-3 rounded-xl border border-border/70 px-3 py-2 text-sm">
            <span>有効</span>
            <Switch
              checked={form.is_active}
              onCheckedChange={(checked) =>
                setForm((current) => ({ ...current, is_active: checked }))
              }
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending || !form.name.trim()}
            >
              {saveMutation.isPending ? '保存中...' : form.id ? '更新' : '登録'}
            </Button>
            {form.id ? (
              <Button variant="outline" onClick={() => setForm(emptyForm)}>
                新規入力に戻る
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">登録済み配薬方法</CardTitle>
          <CardDescription>
            セット管理と患者の既定配薬方法で選択できるマスターです。
          </CardDescription>
        </CardHeader>
        <CardContent>
          {methods.length === 0 ? (
            <p className="rounded-xl border border-state-confirm/30 bg-state-confirm/10 px-3 py-2 text-sm text-state-confirm">
              配薬方法が未登録です。セット作成前に最低1件登録してください。
            </p>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {methods.map((method) => (
                <button
                  key={method.id}
                  type="button"
                  className="rounded-2xl border border-border/70 bg-background p-3 text-left transition-colors hover:border-primary/40 hover:bg-muted/30"
                  onClick={() =>
                    setForm({
                      id: method.id,
                      name: method.name,
                      description: method.description ?? '',
                      icon_key: method.icon_key ?? '',
                      sort_order: String(method.sort_order),
                      is_active: method.is_active,
                    })
                  }
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-medium text-foreground">{method.name}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {method.description ?? '説明未登録'}
                      </p>
                    </div>
                    <Badge variant={method.is_active ? 'default' : 'secondary'}>
                      {method.is_active ? '有効' : '無効'}
                    </Badge>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">表示順 {method.sort_order}</p>
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
