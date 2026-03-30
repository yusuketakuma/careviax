'use client';

import Link from 'next/link';
import { format, parseISO } from 'date-fns';
import { ja } from 'date-fns/locale';
import { CalendarClock, ClipboardPlus, FileText, ListChecks } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import type { PatientCard as PatientCardType } from '@/types/dashboard-home';

const RISK_STYLES: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' }> = {
  high: { label: '高リスク', variant: 'destructive' },
  watch: { label: '要注意', variant: 'secondary' },
  stable: { label: '安定', variant: 'default' },
};

const VISIT_TYPE_LABELS: Record<string, string> = {
  initial: '初回',
  regular: '定期',
  temporary: '臨時',
  revisit: '再訪問',
  delivery_only: '配達',
  emergency: '緊急',
  physician_co_visit: '同行',
};

export function PatientCardItem({ patient }: { patient: PatientCardType }) {
  const risk = RISK_STYLES[patient.level] ?? RISK_STYLES.stable;

  return (
    <Card className="flex flex-col">
      <CardContent className="flex flex-1 flex-col gap-2 p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <Link
              href={`/patients/${patient.patient_id}`}
              className="text-sm font-semibold text-foreground hover:underline"
            >
              {patient.patient_name}
            </Link>
            {patient.reasons.length > 0 && (
              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                {patient.reasons[0]}
              </p>
            )}
          </div>
          <Badge variant={risk.variant} className="shrink-0">
            {risk.label}
            {patient.score > 0 && ` ${patient.score}`}
          </Badge>
        </div>

        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {patient.next_visit_date && (
            <span className="inline-flex items-center gap-1">
              <CalendarClock className="size-3" aria-hidden="true" />
              {format(parseISO(patient.next_visit_date), 'M/d(E)', { locale: ja })}
              {patient.next_visit_type && (
                <span>
                  {VISIT_TYPE_LABELS[patient.next_visit_type] ?? patient.next_visit_type}
                </span>
              )}
            </span>
          )}
          {patient.open_tasks > 0 && (
            <span className="inline-flex items-center gap-1">
              <ListChecks className="size-3" aria-hidden="true" />
              タスク{patient.open_tasks}
            </span>
          )}
          {patient.pending_reports > 0 && (
            <span className="inline-flex items-center gap-1">
              <FileText className="size-3" aria-hidden="true" />
              報告{patient.pending_reports}
            </span>
          )}
        </div>

        {patient.case_id && (
          <div className="mt-auto pt-2">
            <Link
              href={`/prescriptions/new?patient_id=${patient.patient_id}&case_id=${patient.case_id}`}
              className="inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium ring-offset-background transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <ClipboardPlus className="size-3.5" aria-hidden="true" />
              処方受付
            </Link>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
