'use client';

import Link from 'next/link';
import { Building2, CalendarDays, CheckCircle2, CircleAlert, UsersRound } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { PatientOverview } from './patient-detail.types';

const WEEKDAY_LABELS = ['日', '月', '火', '水', '木', '金', '土'];

function formatTime(value: string | null | undefined) {
  if (!value) return null;
  if (/^\d{2}:\d{2}$/.test(value)) return value;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(11, 16);
}

function StatusItem({
  done,
  label,
  description,
}: {
  done: boolean;
  label: string;
  description: string;
}) {
  return (
    <div
      className={cn(
        'rounded-xl border px-3 py-3',
        done ? 'border-emerald-200 bg-emerald-50/70' : 'border-amber-200 bg-amber-50/70',
      )}
    >
      <div className="flex items-start gap-2">
        {done ? (
          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-700" aria-hidden="true" />
        ) : (
          <CircleAlert className="mt-0.5 size-4 shrink-0 text-amber-700" aria-hidden="true" />
        )}
        <div className="space-y-1">
          <p className="text-sm font-medium text-foreground">{label}</p>
          <p className="text-xs leading-5 text-muted-foreground">{description}</p>
        </div>
      </div>
    </div>
  );
}

export function PatientFacilityMultiVisitCard({ patient }: { patient: PatientOverview }) {
  const primaryResidence = patient.residences.find((item) => item.is_primary) ?? null;
  const pref = patient.scheduling_preference;
  const activeCase =
    patient.cases.find((item) => item.status === 'active') ?? patient.cases[0] ?? null;
  const facilityTimeFrom = formatTime(pref?.facility_time_from);
  const facilityTimeTo = formatTime(pref?.facility_time_to);
  const preferredWeekdays = pref?.preferred_weekdays ?? [];
  const careTeamRoles = new Set(activeCase?.care_team_links.map((link) => link.role) ?? []);
  const hasFacility = Boolean(primaryResidence?.facility_id);
  const hasHomeAddress = Boolean(primaryResidence?.address);
  const hasHomeGroup = Boolean(primaryResidence?.building_id);
  const visitGroupReady = hasFacility || hasHomeAddress || hasHomeGroup;
  const locationDetailReady = hasFacility
    ? Boolean(primaryResidence?.facility_unit_id || primaryResidence?.unit_name)
    : Boolean(
        primaryResidence?.building_id || primaryResidence?.unit_name || primaryResidence?.address,
      );
  const facilityTimeReady = Boolean(facilityTimeFrom || facilityTimeTo);
  const careTeamReady =
    careTeamRoles.has('physician') ||
    careTeamRoles.has('nurse') ||
    careTeamRoles.has('care_manager');
  const locationModeLabel = hasFacility ? '施設' : '個人宅';
  const residenceAddress = primaryResidence?.address?.trim() || '住所未登録';

  return (
    <Card className="border-sky-200 bg-sky-50/50">
      <CardHeader className="space-y-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-1">
            <p className="inline-flex items-center rounded-full border border-sky-200 bg-white/70 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-800">
              Facility Multi-Visit
            </p>
            <h2 className="flex items-center gap-2 font-heading text-base leading-snug font-medium text-sky-950">
              <UsersRound className="size-4" aria-hidden="true" />
              施設・個人宅の複数名同時訪問設定
            </h2>
            <p className="max-w-3xl text-sm leading-6 text-sky-900/80">
              施設とユニット、または個人宅の同一住所・同居グループを患者情報に登録しておくと、同日訪問がスケジュール上でまとまり、現地では患者をスワイプで切り替えられます。
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant={visitGroupReady ? 'default' : 'outline'}>
              {locationModeLabel} {visitGroupReady ? '登録済み' : '未設定'}
            </Badge>
            <Badge variant={locationDetailReady ? 'default' : 'outline'}>
              {hasFacility ? 'ユニット' : '同居グループ'}{' '}
              {locationDetailReady ? '登録済み' : '未設定'}
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <StatusItem
            done={visitGroupReady}
            label="訪問先グループ"
            description={
              hasFacility
                ? '患者マスタで施設が紐づいています。'
                : hasHomeAddress
                  ? '個人宅は同一住所の夫婦・同居人を同時訪問グループとして扱います。'
                  : hasHomeGroup
                    ? '個人宅は同居グループIDで夫婦・同居人を同時訪問グループとして扱います。'
                    : '施設または個人宅の住所を登録してください。'
            }
          />
          <StatusItem
            done={locationDetailReady}
            label={hasFacility ? 'ユニット・部屋' : '同居グループ・部屋'}
            description={
              hasFacility
                ? primaryResidence?.facility_unit_id || primaryResidence?.unit_name
                  ? 'ユニットまたは部屋番号が登録されています。'
                  : 'ユニットまたは部屋番号を登録すると施設内順路を見やすくできます。'
                : primaryResidence?.building_id || primaryResidence?.unit_name
                  ? '同居グループIDまたは部屋番号が登録されています。'
                  : '夫婦・同居人をまとめたい場合は、同居グループIDまたは部屋番号を登録してください。'
            }
          />
          <StatusItem
            done={facilityTimeReady}
            label={hasFacility ? '施設受入時間' : '個人宅の訪問希望時間'}
            description={
              facilityTimeReady
                ? `${facilityTimeFrom ?? '未指定'}〜${facilityTimeTo ?? '未指定'} を訪問条件に保持しています。`
                : '訪問条件で受入時間または訪問希望時間を設定してください。'
            }
          />
          <StatusItem
            done={careTeamReady}
            label="連携先"
            description={
              careTeamReady
                ? 'クリニック・訪問看護・ケアマネのいずれかがケアチームに登録されています。'
                : '報告書送付先として使う連携先をケアチームに登録してください。'
            }
          />
        </div>

        <div className="grid gap-3 text-sm md:grid-cols-3">
          <div className="rounded-xl border border-sky-200 bg-white/80 px-3 py-3">
            <div className="flex items-center gap-2 font-medium text-foreground">
              <Building2 className="size-4 text-sky-700" aria-hidden="true" />
              訪問先グループ
            </div>
            <p className="mt-2 text-muted-foreground">
              {hasFacility ? '施設' : '個人宅'} / {residenceAddress}
              {primaryResidence?.unit_name ? ` / ${primaryResidence.unit_name}` : ''}
              {!hasFacility && primaryResidence?.building_id
                ? ` / ${primaryResidence.building_id}`
                : ''}
            </p>
          </div>
          <div className="rounded-xl border border-sky-200 bg-white/80 px-3 py-3">
            <div className="flex items-center gap-2 font-medium text-foreground">
              <CalendarDays className="size-4 text-sky-700" aria-hidden="true" />
              訪問曜日
            </div>
            <p className="mt-2 text-muted-foreground">
              {preferredWeekdays.length > 0
                ? preferredWeekdays.map((day) => WEEKDAY_LABELS[day] ?? String(day)).join('・')
                : '未設定'}
            </p>
          </div>
          <div className="rounded-xl border border-sky-200 bg-white/80 px-3 py-3">
            <div className="flex items-center gap-2 font-medium text-foreground">
              <UsersRound className="size-4 text-sky-700" aria-hidden="true" />
              同時訪問表示
            </div>
            <p className="mt-2 text-muted-foreground">
              スケジュール画面で同一施設または同一個人宅・同日訪問をひとまとめに表示します。
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <a
            href="#patient-facility-section"
            className={buttonVariants({ size: 'sm', variant: 'outline' })}
          >
            施設・ユニットを編集
          </a>
          <a
            href="#patient-visit-constraints-section"
            className={buttonVariants({ size: 'sm', variant: 'outline' })}
          >
            訪問条件を編集
          </a>
          <Link
            href={`/patients/${patient.id}/collaboration`}
            className={buttonVariants({ size: 'sm', variant: 'outline' })}
          >
            連携で編集
          </Link>
          <Link href="/schedules" className={buttonVariants({ size: 'sm' })}>
            スケジュールで確認
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
