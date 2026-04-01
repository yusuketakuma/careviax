let counter = 0;
function id(prefix = 'id') { return `${prefix}_${++counter}`; }

export function buildPatient(overrides?: Record<string, unknown>) {
  return {
    id: id('patient'),
    org_id: 'org_test',
    name: 'テスト患者',
    name_kana: 'テストカンジャ',
    birth_date: new Date('1950-01-15'),
    gender: 'male',
    status: 'active',
    phone: '090-1234-5678',
    address: '東京都千代田区1-1',
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

export function buildCase(overrides?: Record<string, unknown>) {
  return {
    id: id('case'),
    org_id: 'org_test',
    patient_id: id('patient'),
    status: 'active',
    insurance_type: 'medical',
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

export function buildPrescriptionIntake(overrides?: Record<string, unknown>) {
  return {
    id: id('intake'),
    org_id: 'org_test',
    case_id: id('case'),
    source_type: 'fax',
    status: 'pending',
    prescribed_date: new Date(),
    prescriber_name: 'テスト医師',
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

export function buildVisitSchedule(overrides?: Record<string, unknown>) {
  return {
    id: id('schedule'),
    org_id: 'org_test',
    case_id: id('case'),
    pharmacist_id: id('pharmacist'),
    scheduled_date: new Date().toISOString().split('T')[0],
    visit_type: 'regular',
    priority: 'normal',
    schedule_status: 'scheduled',
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

export function buildCareReport(overrides?: Record<string, unknown>) {
  return {
    id: id('report'),
    org_id: 'org_test',
    patient_id: id('patient'),
    case_id: id('case'),
    report_type: 'physician_report',
    status: 'draft',
    content: { summary: 'テスト報告書' },
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

export function resetFactoryCounter() { counter = 0; }
