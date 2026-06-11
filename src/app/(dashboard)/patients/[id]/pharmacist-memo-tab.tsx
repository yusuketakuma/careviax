'use client';

import { format } from 'date-fns';
import { ja } from 'date-fns/locale';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { PatientWorkspace, PatientWorkspaceMedicationChange } from './patient-detail.types';
import type { VisitBrief } from '@/types/visit-brief';

/**
 * p0_08「薬剤師メモ」タブ(既定タブ)。
 * 「今日の見どころ」「処方の変化」「セットの注意」の 3 セクション。
 */

const CHANGE_TYPE_LABELS: Record<PatientWorkspaceMedicationChange['change_type'], string> = {
  added: '追加',
  removed: '中止',
  dose_changed: '用量変更',
  frequency_changed: '用法変更',
};

const SET_METHOD_LABELS: Record<string, string> = {
  facility_calendar: 'お薬カレンダー',
  four_times_daily: '1日4回 別包',
  bedtime_only: '就寝前のみ',
  custom: '個別指定',
};

function MemoSection({
  title,
  children,
  testId,
}: {
  title: string;
  children: React.ReactNode;
  testId?: string;
}) {
  return (
    <Card data-testid={testId}>
      <CardHeader className="pb-2">
        <h3 className="font-heading text-base font-semibold text-foreground">{title}</h3>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

export function PharmacistMemoTab({
  brief,
  workspace,
}: {
  brief: VisitBrief | null;
  workspace: PatientWorkspace | null;
}) {
  const highlights = brief?.must_check_today ?? [];
  const changes = workspace?.medication_changes ?? [];
  const setPlan = workspace?.set_plan ?? null;

  const processingParts: string[] = [];
  if (setPlan) {
    processingParts.push(setPlan.processing.unit_dose ? '一包化' : '一包化なし');
    if (setPlan.processing.separate_pack) processingParts.push('別包あり');
    processingParts.push(setPlan.processing.crushed ? '粉砕あり' : '粉砕なし');
  }

  return (
    <div className="space-y-4">
      <MemoSection title="今日の見どころ" testId="pharmacist-memo-highlights">
        {highlights.length > 0 ? (
          <ul className="space-y-2 text-sm leading-6 text-foreground" role="list">
            {highlights.map((item, index) => (
              <li key={index} className="flex gap-2">
                <span aria-hidden="true" className="text-muted-foreground">
                  ・
                </span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">
            今日の確認ポイントはありません。処方・訪問予定に変化があるとここに表示されます。
          </p>
        )}
      </MemoSection>

      <MemoSection title="処方の変化" testId="pharmacist-memo-changes">
        {changes.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-24">区分</TableHead>
                <TableHead>薬剤</TableHead>
                <TableHead className="w-32">用法</TableHead>
                <TableHead className="w-24">日数</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {changes.map((change) => (
                <TableRow key={`${change.change_type}-${change.drug_name}`}>
                  <TableCell
                    className={
                      change.change_type === 'removed'
                        ? 'font-medium text-destructive'
                        : 'font-medium text-primary'
                    }
                  >
                    {CHANGE_TYPE_LABELS[change.change_type]}
                  </TableCell>
                  <TableCell className="font-medium text-foreground">{change.drug_name}</TableCell>
                  <TableCell>{change.frequency ?? '-'}</TableCell>
                  <TableCell>
                    {change.change_type === 'removed'
                      ? '中止'
                      : change.days != null
                        ? `${change.days}日分`
                        : '-'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <p className="text-sm text-muted-foreground">前回処方からの変化はありません。</p>
        )}
      </MemoSection>

      <MemoSection title="セットの注意" testId="pharmacist-memo-set-notes">
        {setPlan ? (
          <dl className="space-y-2 text-sm leading-6">
            <div className="flex flex-wrap gap-x-2">
              <dt className="shrink-0 text-muted-foreground">セット方法:</dt>
              <dd className="text-foreground">
                {SET_METHOD_LABELS[setPlan.set_method] ?? setPlan.set_method}
                {setPlan.notes ? ` / ${setPlan.notes}` : ''}
              </dd>
            </div>
            <div className="flex flex-wrap gap-x-2">
              <dt className="shrink-0 text-muted-foreground">加工:</dt>
              <dd className="text-foreground">{processingParts.join('、')}。</dd>
            </div>
            <div className="flex flex-wrap gap-x-2">
              <dt className="shrink-0 text-muted-foreground">対象期間:</dt>
              <dd className="text-foreground">
                {format(new Date(setPlan.target_period_start), 'M/d', { locale: ja })}〜
                {format(new Date(setPlan.target_period_end), 'M/d', { locale: ja })}
              </dd>
            </div>
          </dl>
        ) : (
          <p className="text-sm text-muted-foreground">セット計画はまだ作成されていません。</p>
        )}
      </MemoSection>
    </div>
  );
}
