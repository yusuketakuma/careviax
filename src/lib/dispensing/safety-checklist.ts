export const DISPENSE_SAFETY_CHECKLIST_ACK = {
  patient_identity: true,
  drug_name_strength: true,
  quantity_days: true,
  directions_route: true,
  packaging_storage: true,
  cds_alerts_reviewed: true,
} as const;
