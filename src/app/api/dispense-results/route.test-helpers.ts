export const safetyChecklist = {
  patient_identity: true,
  drug_name_strength: true,
  quantity_days: true,
  directions_route: true,
  packaging_storage: true,
  cds_alerts_reviewed: true,
};

export const prescriptionQuantityConfirmed = {
  actual_quantity_confirmed: true,
  actual_quantity_source: 'prescription_quantity_confirmed' as const,
};
