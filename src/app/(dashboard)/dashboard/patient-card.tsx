'use client';

import Link from 'next/link';
import { format, parseISO, differenceInYears } from 'date-fns';
import { ja } from 'date-fns/locale';
import {
  CalendarClock,
  CalendarPlus,
  CirclePause,
  ClipboardPlus,
  Clock,
  FileWarning,
  HeartPulse,
  Hospital,
  LogOut,
  MapPin,
  Phone,
  PhoneOff,
  Pill,
  RefreshCw,
  Sparkles,
  Star,
  TriangleAlert,
  UserCheck,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import type { PatientCard as PatientCardType, PatientStatusIcon } from '@/types/dashboard-home';
import { STATUS_ICON_CONFIG } from '@/lib/patient/status-icon';

// ---------------------------------------------------------------------------
// Status icon → Lucide component mapping
// ---------------------------------------------------------------------------

const STATUS_ICONS: Record<PatientStatusIcon, typeof Star> = {
  stable: UserCheck,
  new: Sparkles,
  first_visit_soon: CalendarPlus,
  attention: Star,
  urgent: TriangleAlert,
  overdue_visit: Clock,
  report_pending: FileWarning,
  medication_change: RefreshCw,
  hospitalized: Hospital,
  discharged: LogOut,
  no_contact: PhoneOff,
  paused: CirclePause,
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

// ---------------------------------------------------------------------------
// Helper: format date concisely
// ---------------------------------------------------------------------------

function formatShortDate(iso: string | null): string | null {
  if (!iso) return null;
  return format(parseISO(iso), 'M/d(E)', { locale: ja });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PatientCardItem({ patient }: { patient: PatientCardType }) {
  const status = STATUS_ICON_CONFIG[patient.status_icon] ?? STATUS_ICON_CONFIG.stable;
  const StatusIcon = STATUS_ICONS[patient.status_icon] ?? UserCheck;
  const parsedBirthDate = patient.birth_date ? parseISO(patient.birth_date) : null;
  const age = parsedBirthDate ? differenceInYears(new Date(), parsedBirthDate) : null;

  return (
    <Card className="flex flex-col">
      <CardContent className="flex flex-1 flex-col gap-2.5 p-4">
        {/* Row 1: Status icon + Name + Age */}
        <div className="flex items-start gap-2.5">
          <div
            className={`mt-0.5 shrink-0 rounded-full p-1.5 ${status.color} ${status.bg}`}
            title={status.label}
          >
            <StatusIcon className="size-4" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2">
              <Link
                href={`/patients/${patient.patient_id}`}
                className="text-sm font-semibold text-foreground hover:underline truncate"
              >
                {patient.patient_name}
              </Link>
              {age !== null && (
                <span className="shrink-0 text-xs text-muted-foreground">
                  {age}歳
                </span>
              )}
            </div>
            {parsedBirthDate && (
              <p className="text-[11px] text-muted-foreground">
                {format(parsedBirthDate, 'yyyy/MM/dd')}生
              </p>
            )}
          </div>
          <Badge
            variant="outline"
            className={`shrink-0 text-[10px] ${status.color} border-current`}
          >
            {status.label}
          </Badge>
        </div>

        {/* Row 2: Contact info */}
        <div className="flex flex-col gap-1 text-xs text-muted-foreground">
          {patient.address && (
            <span className="inline-flex items-start gap-1">
              <MapPin className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
              <span className="line-clamp-1">{patient.address}</span>
            </span>
          )}
          {patient.phone && (
            <span className="inline-flex items-center gap-1">
              <Phone className="size-3 shrink-0" aria-hidden="true" />
              {patient.phone}
            </span>
          )}
        </div>

        {/* Row 3: Conditions */}
        {patient.conditions.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {patient.conditions.map((condition) => (
              <Badge
                key={condition}
                variant="secondary"
                className="text-[10px] font-normal"
              >
                <HeartPulse className="mr-0.5 size-2.5" aria-hidden="true" />
                {condition}
              </Badge>
            ))}
          </div>
        )}

        {/* Row 4: Schedule dates */}
        <div className="grid grid-cols-2 gap-x-2 gap-y-1 text-xs">
          <div className="text-muted-foreground">
            <span className="font-medium">前回処方</span>{' '}
            <span>{formatShortDate(patient.last_prescription_date) ?? '—'}</span>
          </div>
          <div className="text-muted-foreground">
            <span className="font-medium">前回訪問</span>{' '}
            <span>{formatShortDate(patient.last_visit_date) ?? '—'}</span>
          </div>
          <div className="text-foreground">
            <span className="inline-flex items-center gap-0.5">
              <Pill className="size-3" aria-hidden="true" />
              <span className="font-medium">次回処方</span>
            </span>{' '}
            <span>{formatShortDate(patient.next_prescription_date) ?? '—'}</span>
          </div>
          <div className="text-foreground">
            <span className="inline-flex items-center gap-0.5">
              <CalendarClock className="size-3" aria-hidden="true" />
              <span className="font-medium">次回訪問</span>
            </span>{' '}
            <span>
              {formatShortDate(patient.next_visit_date) ?? '—'}
              {patient.next_visit_type && (
                <span className="ml-0.5 text-muted-foreground">
                  {VISIT_TYPE_LABELS[patient.next_visit_type] ?? patient.next_visit_type}
                </span>
              )}
            </span>
          </div>
        </div>

        {(patient.readiness_flags.missing_emergency_contact ||
          patient.readiness_flags.missing_primary_physician ||
          patient.readiness_flags.missing_first_visit_doc) && (
          <div className="flex flex-wrap gap-1">
            {patient.readiness_flags.missing_emergency_contact ? (
              <Badge variant="outline" className="text-[10px] text-amber-700">
                緊急連絡先不足
              </Badge>
            ) : null}
            {patient.readiness_flags.missing_primary_physician ? (
              <Badge variant="outline" className="text-[10px] text-amber-700">
                主治医未登録
              </Badge>
            ) : null}
            {patient.readiness_flags.missing_first_visit_doc ? (
              <Badge variant="outline" className="text-[10px] text-amber-700">
                初回文書未交付
              </Badge>
            ) : null}
          </div>
        )}

        {/* Row 5: Action button */}
        {(patient.case_id || patient.readiness_flags.missing_emergency_contact || patient.readiness_flags.missing_primary_physician || patient.readiness_flags.missing_first_visit_doc) && (
          <div className="mt-auto flex gap-2 pt-1">
            {(patient.readiness_flags.missing_emergency_contact ||
              patient.readiness_flags.missing_primary_physician ||
              patient.readiness_flags.missing_first_visit_doc) && (
              <Link
                href={`/patients/${patient.patient_id}`}
                className={buttonVariants({ variant: 'ghost', size: 'sm', className: 'flex-1' })}
              >
                前提確認
              </Link>
            )}
            {patient.case_id && (
            <Link
              href={`/prescriptions/new?patient_id=${patient.patient_id}&case_id=${patient.case_id}`}
              className={buttonVariants({ variant: 'outline', size: 'sm', className: 'flex-1' })}
            >
              <ClipboardPlus className="size-3.5" aria-hidden="true" />
              処方受付
            </Link>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
