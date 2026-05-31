import type { MedicationCycleStatus, PrescriptionSourceType } from '@prisma/client';

export const PRESCRIPTION_SOURCE_TYPES = [
  'paper',
  'fax',
  'e_prescription',
  'facility_batch',
  'refill',
  'qr_scan',
] as const satisfies readonly [PrescriptionSourceType, ...PrescriptionSourceType[]];

export const MEDICATION_CYCLE_STATUSES = [
  'intake_received',
  'structuring',
  'inquiry_pending',
  'inquiry_resolved',
  'ready_to_dispense',
  'dispensing',
  'dispensed',
  'audit_pending',
  'audited',
  'setting',
  'set_audited',
  'visit_ready',
  'visit_completed',
  'reported',
  'on_hold',
  'cancelled',
] as const satisfies readonly [MedicationCycleStatus, ...MedicationCycleStatus[]];

