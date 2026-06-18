'use client';

import { useQuery } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { cn } from '@/lib/utils';
import { narcoticUseCategoryLabels, specialProcedureLabels } from '@/lib/patient/home-visit-intake';
import type {
  PatientStructuredCareItem,
  PatientStructuredCareList,
} from '@/server/services/patient-structured-care-list';

// 変更履歴タイムラインと同じ出所ラベル(SSOT 化するほどの規模ではないため最小重複に留める)
const SOURCE_LABELS: Record<string, string> = {
  patient_detail_edit: '患者詳細編集',
  visit_record: '訪問記録',
  mcs_sync: 'MCS連携',
  import: '取込',
};

// start_date/end_date は date-only(UTC深夜保存)。ローカル整形だと TZ で前日にずれるため UTC 基準で表示する。
function formatCareDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getUTCFullYear()}/${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
}

function StructuredCareRow({ item, label }: { item: PatientStructuredCareItem; label: string }) {
  return (
    <li className="rounded-lg border border-border/70 bg-background px-3 py-2 text-sm">
      <div className="flex items-center justify-between gap-2">
        <p className="truncate font-medium text-foreground">{label}</p>
        <Badge
          variant="outline"
          className={cn(
            'shrink-0 text-xs',
            item.is_active
              ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
              : 'border-slate-200 bg-slate-50 text-slate-600',
          )}
        >
          {item.is_active ? '実施中' : '終了'}
        </Badge>
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">
        {item.start_date ? `開始 ${formatCareDate(item.start_date)}` : '開始日未設定'}
        {item.end_date ? ` ・ 終了 ${formatCareDate(item.end_date)}` : ''}
        {item.source && item.source !== 'patient_detail_edit'
          ? ` ・ 確認元: ${SOURCE_LABELS[item.source] ?? item.source}`
          : ''}
        {item.confirmed_by_name ? ` ・ ${item.confirmed_by_name}` : ''}
      </p>
    </li>
  );
}

/**
 * 在宅医療処置・麻薬使用の構造化レイヤ(read 専用)。
 * 開始日・確認元(provenance)を時系列で示し、訪問前確認パネル(現時点のラベル)を補完する。
 * 構造化行が無い患者では描画しない(JSON intake は別途表示されるため空カードを出さない)。
 */
export function PatientStructuredCarePanel({ patientId }: { patientId: string }) {
  const orgId = useOrgId();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['patient-structured-care', patientId, orgId],
    queryFn: async () => {
      const response = await fetch(`/api/patients/${patientId}/structured-care`, {
        headers: { 'x-org-id': orgId },
      });
      if (!response.ok) {
        throw new Error('在宅医療処置の取得に失敗しました');
      }
      return (await response.json()) as { data: PatientStructuredCareList };
    },
    enabled: !!orgId,
  });

  const procedures = data?.data?.procedures ?? [];
  const narcotics = data?.data?.narcotics ?? [];

  // 取得中・データ無しは空カードを避けて非表示
  if (isLoading) return null;
  if (error) {
    return (
      <section
        className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-amber-950"
        aria-label="在宅医療処置・麻薬"
        data-testid="patient-structured-care-panel-error"
      >
        <h3 className="text-base font-semibold">在宅医療処置・麻薬</h3>
        <p className="mt-1 text-sm">在宅医療処置・麻薬の取得に失敗しました。</p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-3 min-h-[44px] bg-background sm:min-h-0"
          onClick={() => void refetch()}
        >
          再読み込み
        </Button>
      </section>
    );
  }
  if (procedures.length === 0 && narcotics.length === 0) return null;

  return (
    <section
      className="rounded-lg border border-border/70 bg-card p-4"
      aria-label="在宅医療処置・麻薬"
      data-testid="patient-structured-care-panel"
    >
      <h3 className="text-base font-semibold text-foreground">在宅医療処置・麻薬</h3>
      <p className="mt-1 text-xs text-muted-foreground">
        実施中の処置・麻薬使用を開始日・確認元とともに表示します（JSON入力から自動構造化）。
      </p>

      {procedures.length > 0 && (
        <div className="mt-3">
          <p className="text-xs font-medium text-muted-foreground">医療処置</p>
          <ul className="mt-1.5 space-y-2">
            {procedures.map((item) => (
              <StructuredCareRow
                key={item.id}
                item={item}
                label={specialProcedureLabels[item.kind] ?? item.kind}
              />
            ))}
          </ul>
        </div>
      )}

      {narcotics.length > 0 && (
        <div className="mt-3">
          <p className="text-xs font-medium text-muted-foreground">麻薬使用</p>
          <ul className="mt-1.5 space-y-2">
            {narcotics.map((item) => (
              <StructuredCareRow
                key={item.id}
                item={item}
                label={narcoticUseCategoryLabels[item.kind] ?? item.kind}
              />
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
