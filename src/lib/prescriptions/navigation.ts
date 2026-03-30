export function buildPrescriptionHref(args: {
  patientId: string;
  patientName: string;
  caseId?: string | null;
  cycleId?: string | null;
  sourceType?: string;
}) {
  const params = new URLSearchParams({
    patient_id: args.patientId,
    patient_name: args.patientName,
  });

  if (args.caseId) params.set('case_id', args.caseId);
  if (args.cycleId) params.set('cycle_id', args.cycleId);
  if (args.sourceType) params.set('source_type', args.sourceType);

  return `/prescriptions/new?${params.toString()}`;
}
