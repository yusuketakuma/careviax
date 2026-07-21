export function validPrescriptionIntakeLine() {
  return {
    line_number: 1,
    drug_name: 'アムロジピン錠5mg',
    drug_code: '2149001',
    dose: '1錠',
    frequency: '1日1回朝食後',
    days: 14,
  };
}

export function postCreateHookArgs() {
  return {
    cycleId: 'cycle_1',
    intakeId: 'intake_1',
    patientId: 'patient_1',
    orgId: 'org_1',
    userId: 'user_1',
    lines: [
      {
        drug_name: 'アムロジピン錠5mg',
        drug_code: '2149001',
        dose: '1錠',
        frequency: '1日1回朝食後',
        days: 14,
      },
    ],
    prescriberName: '処方医A',
    sourceType: 'qr_scan' as const,
  };
}
