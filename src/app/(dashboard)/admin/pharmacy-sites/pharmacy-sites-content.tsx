'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { AlertTriangle } from 'lucide-react';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { useOrgId } from '@/lib/hooks/use-org-id';

type PharmacySite = {
  id: string;
  name: string;
  address: string;
  phone: string | null;
  fax: string | null;
  is_health_support_pharmacy: boolean;
  is_regional_support: boolean;
  is_specialized_pharmacy: boolean;
  dispensing_fee_category: string | null;
};

type InsuranceConfig = {
  id: string;
  site_id: string;
  insurance_type: string;
  revision_code: string;
  revision_label: string | null;
  effective_from: string;
  effective_to: string | null;
  config: Record<string, unknown>;
};

type SiteForm = {
  name: string;
  address: string;
  phone: string;
  fax: string;
  is_health_support_pharmacy: boolean;
  is_regional_support: boolean;
  is_specialized_pharmacy: boolean;
  dispensing_fee_category: string;
};

type ConfigForm = {
  insurance_type: string;
  revision_code: string;
  revision_label: string;
  effective_from: string;
  effective_to: string;
  config: Record<string, unknown>;
};

import {
  CARE_BOOL_FIELDS,
  getAvailableRevisions,
  getMedicalConfigFields,
  getDefaultRevisionCode,
  getRevisionMeta,
  normalizeInsuranceConfigForRevision,
} from '@/lib/constants/site-config-fields';

function makeEmptyConfig(): ConfigForm {
  const insuranceType = 'medical';
  const code = getDefaultRevisionCode(insuranceType);
  const meta = getRevisionMeta(code, insuranceType);
  return {
    insurance_type: insuranceType,
    revision_code: code,
    revision_label: meta?.label ?? '',
    effective_from: meta?.effectiveFrom ?? '',
    effective_to: '',
    config: {},
  };
}

const INSURANCE_TYPE_LABELS: Record<string, string> = {
  medical: '医療保険',
  care: '介護保険',
};

export function PharmacySitesContent() {
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  const [editingSite, setEditingSite] = useState<PharmacySite | null>(null);
  const [siteForm, setSiteForm] = useState<SiteForm | null>(null);
  const [configSiteId, setConfigSiteId] = useState<string | null>(null);
  const [configForm, setConfigForm] = useState<ConfigForm | null>(null);
  const [editingConfigId, setEditingConfigId] = useState<string | null>(null);
  const [deleteConfig, setDeleteConfig] = useState<{ siteId: string; configId: string } | null>(
    null,
  );

  const { data, isLoading } = useQuery({
    queryKey: ['pharmacy-sites-admin', orgId],
    queryFn: async () => {
      const response = await fetch('/api/pharmacy-sites', {
        headers: { 'x-org-id': orgId },
      });
      if (!response.ok) throw new Error('薬局情報の取得に失敗しました');
      return response.json() as Promise<{ data: PharmacySite[] }>;
    },
    enabled: !!orgId,
  });

  const sites = data?.data ?? [];

  const configsQuery = useQuery({
    queryKey: ['insurance-configs', orgId, configSiteId],
    queryFn: async () => {
      const response = await fetch(`/api/pharmacy-sites/${configSiteId}/insurance-configs`, {
        headers: { 'x-org-id': orgId },
      });
      if (!response.ok) throw new Error('保険設定の取得に失敗しました');
      return response.json() as Promise<{ data: InsuranceConfig[] }>;
    },
    enabled: !!orgId && !!configSiteId,
  });

  const configs = configsQuery.data?.data ?? [];

  const saveSiteMutation = useMutation({
    mutationFn: async () => {
      if (!editingSite || !siteForm) throw new Error('編集対象がありません');
      const response = await fetch(`/api/pharmacy-sites/${editingSite.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'x-org-id': orgId },
        body: JSON.stringify(siteForm),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error((payload as { message?: string }).message ?? '更新に失敗しました');
      }
      return payload;
    },
    onSuccess: async () => {
      toast.success('薬局情報を更新しました');
      setEditingSite(null);
      setSiteForm(null);
      await queryClient.invalidateQueries({ queryKey: ['pharmacy-sites-admin', orgId] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : '更新に失敗しました');
    },
  });

  const saveConfigMutation = useMutation({
    mutationFn: async () => {
      if (!configSiteId || !configForm) throw new Error('設定対象がありません');
      const url = editingConfigId
        ? `/api/pharmacy-sites/${configSiteId}/insurance-configs/${editingConfigId}`
        : `/api/pharmacy-sites/${configSiteId}/insurance-configs`;
      const method = editingConfigId ? 'PATCH' : 'POST';
      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', 'x-org-id': orgId },
        body: JSON.stringify({
          ...configForm,
          auto_close_overlaps:
            !editingConfigId &&
            configForm.insurance_type === 'medical' &&
            configForm.revision_code === '2026',
          effective_to: configForm.effective_to || null,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error((payload as { message?: string }).message ?? '保存に失敗しました');
      }
      return payload;
    },
    onSuccess: async () => {
      toast.success(editingConfigId ? '保険設定を更新しました' : '保険設定を登録しました');
      setConfigForm(null);
      setEditingConfigId(null);
      await queryClient.invalidateQueries({ queryKey: ['insurance-configs', orgId, configSiteId] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : '保存に失敗しました');
    },
  });

  const deleteConfigMutation = useMutation({
    mutationFn: async () => {
      if (!deleteConfig) throw new Error('削除対象がありません');
      const response = await fetch(
        `/api/pharmacy-sites/${deleteConfig.siteId}/insurance-configs/${deleteConfig.configId}`,
        { method: 'DELETE', headers: { 'x-org-id': orgId } },
      );
      if (!response.ok) throw new Error('削除に失敗しました');
    },
    onSuccess: async () => {
      toast.success('保険設定を削除しました');
      setDeleteConfig(null);
      await queryClient.invalidateQueries({ queryKey: ['insurance-configs', orgId, configSiteId] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : '削除に失敗しました');
    },
  });

  function openSiteEdit(site: PharmacySite) {
    setEditingSite(site);
    setSiteForm({
      name: site.name,
      address: site.address,
      phone: site.phone ?? '',
      fax: site.fax ?? '',
      is_health_support_pharmacy: site.is_health_support_pharmacy,
      is_regional_support: site.is_regional_support,
      is_specialized_pharmacy: site.is_specialized_pharmacy,
      dispensing_fee_category: site.dispensing_fee_category ?? '',
    });
  }

  function has2026Config(insuranceType: string) {
    return configs.some((c) => c.insurance_type === insuranceType && c.revision_code === '2026');
  }

  function cloneConfigFor2026(source: InsuranceConfig) {
    const revisionCode = '2026';
    const meta = getRevisionMeta(revisionCode, source.insurance_type);
    const clonedConfig = normalizeInsuranceConfigForRevision({
      insuranceType: source.insurance_type,
      revisionCode,
      config: (source.config ?? {}) as Record<string, unknown>,
    });

    setEditingConfigId(null);
    setConfigForm({
      insurance_type: source.insurance_type,
      revision_code: revisionCode,
      revision_label: meta?.label ?? '令和8年度改定',
      effective_from: meta?.effectiveFrom ?? '2026-06-01',
      effective_to: '',
      config: clonedConfig,
    });
  }

  function openConfigEdit(config: InsuranceConfig) {
    const normalizedConfig = normalizeInsuranceConfigForRevision({
      insuranceType: config.insurance_type,
      revisionCode: config.revision_code,
      config: (config.config ?? {}) as Record<string, unknown>,
    });

    setEditingConfigId(config.id);
    setConfigForm({
      insurance_type: config.insurance_type,
      revision_code: config.revision_code,
      revision_label:
        config.revision_label ??
        getRevisionMeta(config.revision_code, config.insurance_type)?.label ??
        '',
      effective_from: config.effective_from.slice(0, 10),
      effective_to: config.effective_to?.slice(0, 10) ?? '',
      config: normalizedConfig,
    });
  }

  return (
    <div className="space-y-6">
      {isLoading ? (
        <div className="text-sm text-muted-foreground">読み込み中...</div>
      ) : sites.length === 0 ? (
        <Card>
          <CardContent>
            <div className="text-sm text-muted-foreground">薬局情報がありません。</div>
          </CardContent>
        </Card>
      ) : (
        sites.map((site) => (
          <Card key={site.id}>
            <CardHeader className="flex flex-row items-start justify-between">
              <div>
                <CardTitle className="text-base">{site.name}</CardTitle>
                <div className="mt-1 text-sm text-muted-foreground">{site.address}</div>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => openSiteEdit(site)}>
                  編集
                </Button>
                <Button size="sm" variant="secondary" onClick={() => setConfigSiteId(site.id)}>
                  保険設定
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3 text-sm md:grid-cols-3">
                <div>
                  <span className="text-muted-foreground">電話:</span> {site.phone ?? '未設定'}
                </div>
                <div>
                  <span className="text-muted-foreground">FAX:</span> {site.fax ?? '未設定'}
                </div>
                <div className="flex flex-wrap gap-1">
                  {site.is_health_support_pharmacy && (
                    <Badge variant="outline">健康サポート薬局</Badge>
                  )}
                  {site.is_regional_support && <Badge variant="outline">地域連携薬局</Badge>}
                  {site.is_specialized_pharmacy && (
                    <Badge variant="outline">専門医療機関連携薬局</Badge>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        ))
      )}

      {/* Site Edit Sheet */}
      <Sheet
        open={!!editingSite && !!siteForm}
        onOpenChange={(open) => {
          if (!open) {
            setEditingSite(null);
            setSiteForm(null);
          }
        }}
      >
        <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>薬局情報を編集</SheetTitle>
            <SheetDescription>基本情報と届出フラグを編集します。</SheetDescription>
          </SheetHeader>
          {siteForm && (
            <div className="mt-6 space-y-4">
              <Field label="薬局名">
                <Input
                  value={siteForm.name}
                  onChange={(e) => setSiteForm((f) => (f ? { ...f, name: e.target.value } : f))}
                />
              </Field>
              <Field label="住所">
                <Input
                  value={siteForm.address}
                  onChange={(e) => setSiteForm((f) => (f ? { ...f, address: e.target.value } : f))}
                />
              </Field>
              <Field label="電話番号">
                <Input
                  value={siteForm.phone}
                  onChange={(e) => setSiteForm((f) => (f ? { ...f, phone: e.target.value } : f))}
                />
              </Field>
              <Field label="FAX">
                <Input
                  value={siteForm.fax}
                  onChange={(e) => setSiteForm((f) => (f ? { ...f, fax: e.target.value } : f))}
                />
              </Field>
              <div className="space-y-3 rounded-lg border border-border p-4">
                <div className="text-sm font-medium">届出フラグ</div>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={siteForm.is_health_support_pharmacy}
                    onCheckedChange={(c) =>
                      setSiteForm((f) => (f ? { ...f, is_health_support_pharmacy: c === true } : f))
                    }
                  />
                  健康サポート薬局
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={siteForm.is_regional_support}
                    onCheckedChange={(c) =>
                      setSiteForm((f) => (f ? { ...f, is_regional_support: c === true } : f))
                    }
                  />
                  地域連携薬局
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={siteForm.is_specialized_pharmacy}
                    onCheckedChange={(c) =>
                      setSiteForm((f) => (f ? { ...f, is_specialized_pharmacy: c === true } : f))
                    }
                  />
                  専門医療機関連携薬局
                </label>
              </div>
              <div className="flex justify-end gap-2 pt-4">
                <Button
                  variant="outline"
                  onClick={() => {
                    setEditingSite(null);
                    setSiteForm(null);
                  }}
                >
                  キャンセル
                </Button>
                <Button
                  onClick={() => saveSiteMutation.mutate()}
                  disabled={saveSiteMutation.isPending}
                >
                  {saveSiteMutation.isPending ? '保存中...' : '更新する'}
                </Button>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* Insurance Config Sheet */}
      <Sheet
        open={!!configSiteId}
        onOpenChange={(open) => {
          if (!open) {
            setConfigSiteId(null);
            setConfigForm(null);
            setEditingConfigId(null);
          }
        }}
      >
        <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
          <SheetHeader>
            <SheetTitle>保険算定設定</SheetTitle>
            <SheetDescription>改定年度ごとの保険種別設定を管理します。</SheetDescription>
          </SheetHeader>
          <div className="mt-6 space-y-4">
            <div className="flex items-center justify-between">
              <div className="text-sm font-medium">登録済み設定</div>
              <Button
                size="sm"
                onClick={() => {
                  setConfigForm(makeEmptyConfig());
                  setEditingConfigId(null);
                }}
              >
                設定を追加
              </Button>
            </div>

            {/* 2026改定への移行アラート */}
            {new Date() >= new Date('2026-03-01') &&
              configs.some((c) => c.insurance_type === 'medical' && c.revision_code === '2024') &&
              !configs.some(
                (c) => c.insurance_type === 'medical' && c.revision_code === '2026',
              ) && (
                <Alert variant="destructive">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertTitle>2026年改定の医療保険設定が未作成です</AlertTitle>
                  <AlertDescription>
                    令和8年度診療報酬改定（2026年6月1日施行）に対応する保険設定を作成してください。
                    既存の2024設定カードの「2026設定を作成」ボタンから簡単に作成できます。
                  </AlertDescription>
                </Alert>
              )}

            {configs.length === 0 ? (
              <div className="text-sm text-muted-foreground">
                保険設定はまだ登録されていません。
              </div>
            ) : (
              configs.map((config) => (
                <Card key={config.id}>
                  <CardContent className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline">
                          {INSURANCE_TYPE_LABELS[config.insurance_type] ?? config.insurance_type}
                        </Badge>
                        <span className="text-sm font-medium">
                          {config.revision_label ?? config.revision_code}
                        </span>
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {config.effective_from.slice(0, 10)} ~{' '}
                        {config.effective_to?.slice(0, 10) ?? '現行'}
                      </div>
                    </div>
                    <div className="flex gap-1">
                      {config.insurance_type === 'medical' &&
                        config.revision_code === '2024' &&
                        !has2026Config(config.insurance_type) && (
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => cloneConfigFor2026(config)}
                          >
                            2026設定を作成
                          </Button>
                        )}
                      <Button size="sm" variant="outline" onClick={() => openConfigEdit(config)}>
                        編集
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() =>
                          setDeleteConfig({ siteId: config.site_id, configId: config.id })
                        }
                      >
                        削除
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}

            {/* Config Form */}
            {configForm && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">
                    {editingConfigId ? '設定を編集' : '設定を追加'}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-4 md:grid-cols-2">
                    <Field label="保険種別">
                      <Select
                        value={configForm.insurance_type}
                        onValueChange={(v) => {
                          if (!v) return;
                          const code = getDefaultRevisionCode(v);
                          const meta = getRevisionMeta(code, v);
                          setConfigForm((f) =>
                            f
                              ? {
                                  ...f,
                                  insurance_type: v,
                                  revision_code: code,
                                  revision_label: meta?.label ?? '',
                                  effective_from: meta?.effectiveFrom ?? '',
                                  config: {},
                                }
                              : f,
                          );
                        }}
                        disabled={!!editingConfigId}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="medical">医療保険</SelectItem>
                          <SelectItem value="care">介護保険</SelectItem>
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field label="改定年度">
                      <Select
                        value={configForm.revision_code}
                        onValueChange={(v) => {
                          if (!v) return;
                          const meta = getRevisionMeta(v, configForm.insurance_type);
                          setConfigForm((f) =>
                            f
                              ? {
                                  ...f,
                                  revision_code: v,
                                  revision_label: meta?.label ?? f.revision_label,
                                  effective_from: meta?.effectiveFrom ?? f.effective_from,
                                  config: {},
                                }
                              : f,
                          );
                        }}
                        disabled={!!editingConfigId}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {getAvailableRevisions(configForm.insurance_type).map((rev) => (
                            <SelectItem key={rev.code} value={rev.code}>
                              {rev.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field label="施行日">
                      <Input
                        type="date"
                        value={configForm.effective_from}
                        onChange={(e) =>
                          setConfigForm((f) => (f ? { ...f, effective_from: e.target.value } : f))
                        }
                      />
                    </Field>
                    <Field label="終了日（空欄=現行）">
                      <Input
                        type="date"
                        value={configForm.effective_to}
                        onChange={(e) =>
                          setConfigForm((f) => (f ? { ...f, effective_to: e.target.value } : f))
                        }
                      />
                    </Field>
                  </div>

                  {/* Config-specific fields */}
                  <div className="space-y-3 rounded-lg border border-dashed border-border p-4">
                    <div className="text-sm font-medium">算定項目設定</div>
                    {configForm.insurance_type === 'medical' &&
                      (() => {
                        const { configFields, boolFields } = getMedicalConfigFields(
                          configForm.revision_code,
                        );
                        return (
                          <>
                            {configFields.map((field) => (
                              <Field key={field.key} label={field.label}>
                                <Select
                                  value={(configForm.config[field.key] as string) || '__none'}
                                  onValueChange={(v) =>
                                    setConfigForm((f) =>
                                      f
                                        ? {
                                            ...f,
                                            config: {
                                              ...f.config,
                                              [field.key]: v === '__none' ? undefined : v,
                                            },
                                          }
                                        : f,
                                    )
                                  }
                                >
                                  <SelectTrigger>
                                    <SelectValue placeholder="選択してください" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {field.options.map(([value, label]) => (
                                      <SelectItem key={value || '__none'} value={value || '__none'}>
                                        {label}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </Field>
                            ))}
                            {boolFields.map((field) => (
                              <label key={field.key} className="flex items-center gap-2 text-sm">
                                <Checkbox
                                  checked={configForm.config[field.key] === true}
                                  onCheckedChange={(c) =>
                                    setConfigForm((f) =>
                                      f
                                        ? { ...f, config: { ...f.config, [field.key]: c === true } }
                                        : f,
                                    )
                                  }
                                />
                                {field.label}
                              </label>
                            ))}
                          </>
                        );
                      })()}
                    {configForm.insurance_type === 'care' && (
                      <>
                        {CARE_BOOL_FIELDS.map((field) => (
                          <label key={field.key} className="flex items-center gap-2 text-sm">
                            <Checkbox
                              checked={configForm.config[field.key] === true}
                              onCheckedChange={(c) =>
                                setConfigForm((f) =>
                                  f
                                    ? { ...f, config: { ...f.config, [field.key]: c === true } }
                                    : f,
                                )
                              }
                            />
                            {field.label}
                          </label>
                        ))}
                      </>
                    )}
                  </div>

                  <div className="flex justify-end gap-2">
                    <Button
                      variant="outline"
                      onClick={() => {
                        setConfigForm(null);
                        setEditingConfigId(null);
                      }}
                    >
                      キャンセル
                    </Button>
                    <Button
                      onClick={() => saveConfigMutation.mutate()}
                      disabled={saveConfigMutation.isPending}
                    >
                      {saveConfigMutation.isPending
                        ? '保存中...'
                        : editingConfigId
                          ? '更新する'
                          : '登録する'}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </SheetContent>
      </Sheet>

      {/* Delete Confirmation */}
      <Dialog open={!!deleteConfig} onOpenChange={(open) => !open && setDeleteConfig(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>保険設定を削除</DialogTitle>
            <DialogDescription>この操作は取り消せません。本当に削除しますか？</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfig(null)}>
              キャンセル
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteConfigMutation.mutate()}
              disabled={deleteConfigMutation.isPending}
            >
              {deleteConfigMutation.isPending ? '削除中...' : '削除する'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <Label className="mb-1.5 block">{label}</Label>
      {children}
    </div>
  );
}
