'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { buttonVariants } from '@/components/ui/button';
import { Button } from '@/components/ui/button';
import { ErrorState } from '@/components/ui/error-state';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/loading';
import { Textarea } from '@/components/ui/textarea';
import { buildOrgHeaders } from '@/lib/api/org-headers';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { cn } from '@/lib/utils';
import {
  FACILITY_PACKET_MEMO_FIELDS,
  facilityPacketMemoDisplayItems,
  facilityPacketStatusLabel,
  isFacilityPacketMemoEmpty,
  parseFacilityPacketMemo,
  sortFacilityPacketPatients,
  type FacilityPacketMemo,
  type FacilityPacketPatient,
} from '@/lib/visits/facility-packet';

/**
 * p0_24「施設モード・訪問パケット」: 施設の本日訪問(部屋カード列)、
 * 施設訪問パケット(入館方法・駐車場などの構造化申し送り)、次にやることの3カラム。
 * データは visit-preparations の facility_parallel_context を使う。
 * 申し送りメモは 5 項目(入館 / 駐車 / ナースステーション / カート / 申し送り)の
 * 構造化フォームで編集し、facility-visit-batches API へ保存する。
 */

type FacilityParallelContext = {
  label: string | null;
  place_kind: 'facility' | 'home_group' | 'address' | null;
  site_name: string | null;
  common_notes: string | null;
  current_schedule_id: string;
  patients: FacilityPacketPatient[];
};

type PreparationSnapshot = {
  data: {
    pack: {
      facility_parallel_context?: FacilityParallelContext | null;
    };
  };
};

export function FacilityPacketContent({ scheduleId }: { scheduleId: string }) {
  const orgId = useOrgId();
  const queryClient = useQueryClient();

  const preparationQuery = useQuery<PreparationSnapshot>({
    queryKey: ['visit-preparation-facility-packet', scheduleId, orgId],
    queryFn: async () => {
      const res = await fetch(`/api/visit-preparations/${scheduleId}`, {
        headers: buildOrgHeaders(orgId),
      });
      if (!res.ok) throw new Error('施設訪問パケットの取得に失敗しました');
      return res.json();
    },
    enabled: !!orgId && !!scheduleId,
  });

  if (!orgId || preparationQuery.isLoading) {
    return (
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_260px]" role="status">
        {Array.from({ length: 3 }).map((_, index) => (
          <Skeleton key={index} className="h-72 w-full rounded-lg" />
        ))}
      </div>
    );
  }

  if (preparationQuery.isError) {
    return (
      <div className="rounded-lg border border-border/70 bg-card p-4">
        <ErrorState
          variant="server"
          title="施設訪問パケットを表示できません"
          description="施設訪問パケットの取得に失敗しました。再試行してください。"
          onRetry={() => void preparationQuery.refetch()}
        />
      </div>
    );
  }

  const context = preparationQuery.data?.data.pack.facility_parallel_context ?? null;
  if (!context) {
    return (
      <div className="rounded-lg border border-border/70 bg-card p-6 text-center">
        <p className="text-sm text-muted-foreground">
          この訪問は施設一括の対象ではありません。施設一括の設定はスケジュールから行えます。
        </p>
        <Link
          href={`/visits/${scheduleId}/record`}
          className={cn(buttonVariants({ variant: 'outline' }), 'mt-4 min-h-11')}
        >
          訪問記録へ戻る
        </Link>
      </div>
    );
  }

  const patients = sortFacilityPacketPatients(context.patients);
  const facilityLabel = context.label ?? context.site_name ?? '施設';
  const startScheduleId = context.current_schedule_id || scheduleId;

  return (
    <div
      className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_260px]"
      data-testid="facility-packet-page"
    >
      <section
        aria-labelledby="facility-packet-roster-heading"
        className="rounded-lg border border-border/70 bg-card p-4"
      >
        <h2 id="facility-packet-roster-heading" className="text-base font-bold text-foreground">
          {facilityLabel} 本日訪問
        </h2>
        <p className="mt-0.5 text-xs text-muted-foreground">フロア・部屋番号順でまとめて処理</p>
        <ul className="mt-3 space-y-2.5" role="list">
          {patients.map((patient) => (
            <li
              key={patient.schedule_id}
              data-testid="facility-packet-patient"
              className="rounded-lg border border-border/70 bg-background px-3 py-2.5"
            >
              <p className="text-sm font-bold text-foreground">
                {patient.unit_name ? `${patient.unit_name}号室　` : ''}
                {patient.patient_name} 様
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {facilityPacketStatusLabel(patient)}
                {patient.preparation_blockers_count > 0
                  ? ` / 止まり${patient.preparation_blockers_count}件`
                  : ''}
              </p>
            </li>
          ))}
        </ul>
      </section>

      <FacilityPacketMemoSection
        orgId={orgId}
        notes={context.common_notes}
        orderedScheduleIds={patients.map((patient) => patient.schedule_id)}
        expectedRouteOrders={patients.map((patient) => ({
          schedule_id: patient.schedule_id,
          route_order: patient.route_order,
        }))}
        onSaved={() =>
          void queryClient.invalidateQueries({ queryKey: ['visit-preparation-facility-packet'] })
        }
      />

      <aside
        aria-label="次にやること"
        className="h-fit rounded-lg border border-border/70 bg-card p-4"
      >
        <h2 className="text-base font-bold text-foreground">次にやること</h2>
        <div className="mt-3 space-y-2.5">
          <Link
            href={`/visits/${startScheduleId}/record`}
            className={cn(buttonVariants({ variant: 'default' }), 'min-h-11 w-full')}
          >
            訪問モードを開始
          </Link>
          <Button
            type="button"
            variant="outline"
            className="min-h-11 w-full text-primary"
            onClick={() => window.print()}
          >
            施設用メモを印刷
          </Button>
        </div>
      </aside>
    </div>
  );
}

/** 施設訪問パケット(中央カラム): 構造化メモの表示と編集フォーム。 */
function FacilityPacketMemoSection({
  orgId,
  notes,
  orderedScheduleIds,
  expectedRouteOrders,
  onSaved,
}: {
  orgId: string;
  notes: string | null;
  orderedScheduleIds: string[];
  expectedRouteOrders: Array<{ schedule_id: string; route_order: number | null }>;
  onSaved: () => void;
}) {
  const savedMemo = useMemo(() => parseFacilityPacketMemo(notes), [notes]);
  const [editing, setEditing] = useState(false);
  // ドラフトは編集開始時に savedMemo から初期化する(表示は常に savedMemo を使う)。
  const [draft, setDraft] = useState<FacilityPacketMemo>(savedMemo);

  const saveMutation = useMutation({
    mutationFn: async (memo: FacilityPacketMemo) => {
      const res = await fetch('/api/facility-visit-batches', {
        method: 'POST',
        headers: buildOrgHeaders(orgId, { 'content-type': 'application/json' }),
        body: JSON.stringify({
          schedule_ids: orderedScheduleIds,
          ordered_schedule_ids: orderedScheduleIds,
          expected_route_orders: expectedRouteOrders,
          packet_memo: memo,
        }),
      });
      if (!res.ok) throw new Error('施設訪問パケットの保存に失敗しました');
      return res.json();
    },
    onSuccess: () => {
      toast.success('施設訪問パケットを保存しました');
      setEditing(false);
      onSaved();
    },
    onError: () => {
      toast.error('施設訪問パケットの保存に失敗しました');
    },
  });

  const displayItems = facilityPacketMemoDisplayItems(savedMemo);

  return (
    <section
      aria-labelledby="facility-packet-notes-heading"
      className="rounded-lg border border-border/70 bg-card p-4"
    >
      <div className="flex items-start justify-between gap-2">
        <h2 id="facility-packet-notes-heading" className="text-base font-bold text-foreground">
          施設訪問パケット
        </h2>
        {!editing && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="min-h-9"
            aria-label="施設訪問パケットを編集"
            onClick={() => {
              setDraft(savedMemo);
              setEditing(true);
            }}
          >
            編集
          </Button>
        )}
      </div>

      {editing ? (
        <form
          className="mt-3 space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            saveMutation.mutate(draft);
          }}
        >
          {FACILITY_PACKET_MEMO_FIELDS.map((field) => (
            <div key={field.key} className="space-y-1">
              <Label htmlFor={`facility-packet-${field.key}`}>{field.label}</Label>
              <Textarea
                id={`facility-packet-${field.key}`}
                value={draft[field.key]}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, [field.key]: event.target.value }))
                }
                rows={2}
                maxLength={2000}
                className="min-h-11"
              />
            </div>
          ))}
          <div className="flex items-center gap-2 pt-1">
            <Button
              type="submit"
              variant="default"
              className="min-h-11"
              disabled={saveMutation.isPending}
            >
              {saveMutation.isPending ? '保存中…' : '保存'}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="min-h-11"
              disabled={saveMutation.isPending}
              onClick={() => {
                setDraft(savedMemo);
                setEditing(false);
              }}
            >
              キャンセル
            </Button>
          </div>
        </form>
      ) : isFacilityPacketMemoEmpty(savedMemo) ? (
        <p className="mt-3 text-sm text-muted-foreground">
          施設メモは未登録です。「編集」から入館方法や駐車場などを登録できます。
        </p>
      ) : (
        <ul className="mt-3 space-y-2.5" role="list">
          {displayItems.map((item) => (
            <li key={item.key} className="text-sm leading-6 text-foreground">
              ・{item.label}：
              {item.value.split(/\r?\n/).map((line, lineIndex) => (
                <span key={lineIndex} className={lineIndex > 0 ? 'block pl-[2.5em]' : undefined}>
                  {line}
                </span>
              ))}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
