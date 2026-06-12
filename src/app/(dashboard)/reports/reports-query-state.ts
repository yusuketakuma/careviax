import type { ReportsFocus } from '@/lib/dashboard/home-link-builders';

type SearchParamRecord = Record<string, string | string[] | undefined> | null | undefined;

export type ReportsInitialState = {
  initialFocus?: ReportsFocus;
  initialDeliveryStatus?: string | null;
  initialContext?: string | null;
  initialPatientId?: string | null;
  initialVisitRecordId?: string | null;
};

export function readReportsState(params: SearchParamRecord): ReportsInitialState {
  const focus = typeof params?.focus === 'string' ? params.focus : null;
  const deliveryStatus =
    typeof params?.delivery_status === 'string' ? params.delivery_status : null;
  const context = typeof params?.context === 'string' ? params.context : null;
  const patientId = typeof params?.patient_id === 'string' ? params.patient_id : null;
  const visitRecordId =
    typeof params?.visit_record_id === 'string' ? params.visit_record_id : null;

  return {
    initialFocus:
      focus === 'reports' || focus === 'tracing' || focus === 'delivery' ? focus : undefined,
    initialDeliveryStatus: deliveryStatus,
    initialContext: context,
    initialPatientId: patientId,
    initialVisitRecordId: visitRecordId,
  };
}
