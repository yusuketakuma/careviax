'use client';

import type { FacilityVisitContext } from '@/lib/visits/facility-visit-context';
import { useVisitRecordFormController } from './visit-record-form-controller';
import { VisitRecordFormView } from './visit-record-form-view';

export { fetchVisitRecordCdsAlerts } from './visit-record-form-model';

export function VisitRecordForm({
  id,
  facilityVisitContext = null,
  medicationStockObservationWriteEnabled = false,
}: {
  id: string;
  facilityVisitContext?: FacilityVisitContext | null;
  medicationStockObservationWriteEnabled?: boolean;
}) {
  const controller = useVisitRecordFormController({
    id,
    facilityVisitContext,
    medicationStockObservationWriteEnabled,
  });
  return <VisitRecordFormView controller={controller} />;
}
