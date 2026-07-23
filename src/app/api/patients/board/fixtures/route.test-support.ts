import { afterAll, afterEach, beforeAll, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { getPerformanceSnapshot, resetPerformanceMetrics } from '@/lib/utils/performance';

const {
  authContextMock,
  withAuthContextOptions,
  patientFindManyMock,
  patientCountMock,
  dispenseTaskFindManyMock,
  workflowExceptionFindManyMock,
} = vi.hoisted(() => ({
  authContextMock: { orgId: 'org_1', userId: 'user_1', role: 'admin' },
  withAuthContextOptions: [] as Array<{ permission?: string; message?: string }>,
  patientFindManyMock: vi.fn(),
  patientCountMock: vi.fn(),
  dispenseTaskFindManyMock: vi.fn(),
  workflowExceptionFindManyMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  withAuthContext: (
    handler: (...args: unknown[]) => unknown,
    options?: { permission?: string; message?: string },
  ) => {
    withAuthContextOptions.push(options ?? {});
    return (req: NextRequest, routeContext: { params: Promise<Record<string, string>> }) =>
      handler(req, authContextMock, routeContext);
  },
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    patient: { findMany: patientFindManyMock, count: patientCountMock },
    dispenseTask: { findMany: dispenseTaskFindManyMock },
    workflowException: { findMany: workflowExceptionFindManyMock },
  },
}));

import { GET } from '../route';

const ORIGINAL_TZ = process.env.TZ;

function createRequest(search = '?scope=all') {
  return new NextRequest(`http://localhost/api/patients/board${search}`);
}

type PatientBoardTestMedicationCycle = {
  id: string;
  overall_status: string;
  exception_status: string | null;
  updated_at: Date;
  prescription_intakes: Array<{
    lines: Array<{
      packaging_instruction_tags: string[];
      dispensing_method: string | null;
    }>;
  }>;
  inquiries: Array<{ inquired_at: Date; resolved_at: Date | null }>;
  dispense_tasks: Array<{
    due_date: Date | null;
    audits: Array<{ result: string }>;
  }>;
  workflow_exceptions: Array<{
    exception_type: string;
    description: string;
    created_at: Date;
  }>;
};

function buildPatientRow(scheduledDate: Date) {
  return {
    id: 'patient_1',
    name: '佐藤 花子',
    name_kana: 'サトウ ハナコ',
    birth_date: new Date('1940-01-15T00:00:00.000Z'),
    medical_insurance_number: 'medical_1' as string | null,
    care_insurance_number: null,
    allergy_info: null,
    scheduling_preference: {
      swallowing_route: null,
      preferred_contact_name: null,
      preferred_contact_phone: '090-1111-2222' as string | null,
      visit_before_contact_required: false,
      parking_available: false,
      care_level: 'care_3',
    },
    contacts: [
      {
        is_primary: true,
        is_emergency_contact: true,
        phone: '090-1111-2222',
        email: null,
        fax: null,
      },
    ],
    residences: [],
    lab_observations: [],
    consents: [{ id: 'consent_1' }],
    cases: [
      {
        id: 'case_1',
        status: 'active',
        management_plans: [
          {
            id: 'plan_1',
            next_review_date: null,
          },
        ],
        care_team_links: [
          {
            role: 'physician',
            phone: '03-1111-1111',
            email: null,
            fax: '03-1111-1112',
            is_primary: true,
          },
          {
            role: 'nurse',
            phone: '03-2222-2222',
            email: null,
            fax: '03-2222-2223',
            is_primary: true,
          },
          {
            role: 'care_manager',
            phone: '03-3333-3333',
            email: null,
            fax: '03-3333-3334',
            is_primary: true,
          },
        ],
        care_reports: [] as Array<{ id: string; status: string }>,
        medication_cycles: [] as PatientBoardTestMedicationCycle[],
        visit_schedules: [
          {
            id: 'schedule_1',
            scheduled_date: scheduledDate,
            time_window_start: null,
            carry_items_status: 'ready',
            facility_batch_id: null as string | null,
            facility_batch: null as { patient_ids: string[] } | null,
            preparation: null,
          },
        ],
      },
    ],
  };
}

export function getPatientBoardRouteTestSupport() {
  return {
    withAuthContextOptions,
    patientFindManyMock,
    patientCountMock,
    dispenseTaskFindManyMock,
    workflowExceptionFindManyMock,
    GET,
    createRequest,
    buildPatientRow,
    getPerformanceSnapshot,
  };
}

export function registerPatientBoardRouteHooks() {
  beforeAll(() => {
    process.env.TZ = 'Asia/Tokyo';
  });

  afterAll(() => {
    if (ORIGINAL_TZ === undefined) {
      delete process.env.TZ;
    } else {
      process.env.TZ = ORIGINAL_TZ;
    }
  });

  beforeEach(() => {
    vi.clearAllMocks();
    resetPerformanceMetrics();
    patientFindManyMock.mockResolvedValue([]);
    patientCountMock.mockResolvedValue(0);
    dispenseTaskFindManyMock.mockResolvedValue([]);
    workflowExceptionFindManyMock.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });
}
