'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { buttonVariants } from '@/components/ui/button';
import { Button } from '@/components/ui/button';
import { ErrorState } from '@/components/ui/error-state';
import { Skeleton } from '@/components/ui/loading';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { cn } from '@/lib/utils';
import {
  facilityPacketStatusLabel,
  sortFacilityPacketPatients,
  splitFacilityPacketNotes,
  type FacilityPacketPatient,
} from './facility-packet.shared';

/**
 * p0_24「施設モード・訪問パケット」: 施設の本日訪問(部屋カード列)、
 * 施設訪問パケット(入館方法・駐車場などの申し送り)、次にやることの3カラム。
 * データは visit-preparations の facility_parallel_context を使う。
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

  const preparationQuery = useQuery<PreparationSnapshot>({
    queryKey: ['visit-preparation-facility-packet', scheduleId, orgId],
    queryFn: async () => {
      const res = await fetch(`/api/visit-preparations/${scheduleId}`, {
        headers: { 'x-org-id': orgId },
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
          action={{ label: '再試行', onClick: () => void preparationQuery.refetch() }}
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
  const packetItems = splitFacilityPacketNotes(context.common_notes);
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

      <section
        aria-labelledby="facility-packet-notes-heading"
        className="rounded-lg border border-border/70 bg-card p-4"
      >
        <h2 id="facility-packet-notes-heading" className="text-base font-bold text-foreground">
          施設訪問パケット
        </h2>
        {packetItems.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">
            施設メモは未登録です。スケジュールの施設一括設定から追加できます。
          </p>
        ) : (
          <ul className="mt-3 space-y-2.5" role="list">
            {packetItems.map((item) => (
              <li key={item} className="text-sm leading-6 text-foreground">
                ・{item}
              </li>
            ))}
          </ul>
        )}
      </section>

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
