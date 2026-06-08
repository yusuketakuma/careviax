import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { attachLocalSession, createInstrumentedPage, openStableRoute } from './helpers/local-auth';

const ORG_ID = 'cmnhseedorg0000amq9ph-os';
const USER_ID = 'cmnb3swgz0008wgq9gfpgjq6r';
const IDS = {
  careChangeCase: 'cmnhseedcase002amq9ph-os',
  publicSubsidy54Case: 'cmnhseedcase003amq9ph-os',
  careApplyingCase: 'cmnhseedcase004amq9ph-os',
  publicSubsidy21Case: 'cmnhseedcase005amq9ph-os',
  prescriptionPatient: 'cmnhseedpt001amq9ph-os',
  prescriptionCase: 'cmnhseedcase001amq9ph-os',
  availablePump: 'cmnhseedpca001amq9ph-os',
  rentedPump: 'cmnhseedpca002amq9ph-os',
  activeRental: 'cmnhseedrental001amq9ph-os',
  institution: 'cmnhseedinst001amq9ph-os',
} as const;

test.describe('billing/PCA/prescription guardrails', () => {
  test.beforeEach(async ({ context }) => {
    await attachLocalSession(context);
  });

  test('billing preview blocks care applying, care change-pending, and public subsidy 21/54 applying cases', async ({
    context,
  }) => {
    test.slow();
    const { page, errors } = await createApiPage(context);

    const careApplyingPreview = await fetchBillingPreview(page, IDS.careApplyingCase);
    expect(careApplyingPreview.status).toBe(200);
    expect(careApplyingPreview.body.alerts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'care_insurance_application_pending',
          message: expect.stringContaining('介護保険資格が申請中'),
          details: expect.objectContaining({
            application_status: 'applying',
            insurance_number_present: false,
          }),
        }),
      ]),
    );

    const careChangePreview = await apiFetch(page, {
      path: `/api/visit-schedule-proposals/billing-preview?case_id=${IDS.careChangeCase}&proposed_date=2026-06-10&pharmacist_id=${USER_ID}`,
      method: 'GET',
    });
    expect(careChangePreview.status).toBe(200);
    expect(careChangePreview.body.alerts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'care_insurance_application_pending',
          message: expect.stringContaining('区分変更中'),
          details: expect.objectContaining({
            application_status: 'change_pending',
            previous_care_level: 'care_1',
            provisional_care_level: 'care_2',
          }),
        }),
      ]),
    );

    const publicSubsidy54Preview = await fetchBillingPreview(page, IDS.publicSubsidy54Case);
    expect(publicSubsidy54Preview.status).toBe(200);
    expect(publicSubsidy54Preview.body.alerts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'public_subsidy_application_pending',
          message: expect.stringContaining('公費54が申請中'),
          details: expect.objectContaining({
            application_status: 'applying',
            public_program_code: '54',
            insurer_number_present: false,
            recipient_number_present: false,
          }),
        }),
      ]),
    );

    const publicSubsidy21Preview = await fetchBillingPreview(page, IDS.publicSubsidy21Case);
    expect(publicSubsidy21Preview.status).toBe(200);
    expect(publicSubsidy21Preview.body.alerts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'public_subsidy_application_pending',
          message: expect.stringContaining('公費21が申請中'),
          details: expect.objectContaining({
            application_status: 'applying',
            public_program_code: '21',
            insurer_number_present: false,
            recipient_number_present: false,
          }),
        }),
      ]),
    );

    expect(withoutExpectedValidationConsole(errors)).toEqual([]);
  });

  test('PCA rental APIs expose open rental state and reject double-renting unavailable pumps', async ({
    context,
  }) => {
    const { page, errors } = await createApiPage(context);

    const openRentals = await apiFetch(page, {
      path: '/api/pca-pump-rentals?status=open',
      method: 'GET',
    });
    expect(openRentals.status).toBe(200);
    expect(openRentals.body.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: IDS.activeRental,
          status: 'active',
          rented_at: '2026-06-01',
          due_at: '2026-06-30',
          pump: expect.objectContaining({
            id: IDS.rentedPump,
            asset_code: 'PCA-SEED-002',
            status: 'rented',
          }),
          institution: expect.objectContaining({
            id: IDS.institution,
            name: 'サンプル在宅クリニック',
          }),
        }),
      ]),
    );

    const doubleRentAttempt = await apiFetch(page, {
      path: '/api/pca-pump-rentals',
      method: 'POST',
      body: {
        pump_id: IDS.rentedPump,
        institution_id: IDS.institution,
        status: 'active',
        rented_at: '2026-06-10',
        due_at: '2026-06-30',
      },
    });
    expect(doubleRentAttempt.status).toBe(400);
    expect(doubleRentAttempt.body.message).toContain('利用可能なPCAポンプだけ貸出登録できます');

    expect(withoutExpectedValidationConsole(errors)).toEqual([]);
  });

  test('PCA rental API creates a rental and holds returned pump for maintenance', async ({
    context,
  }) => {
    const { page, errors } = await createApiPage(context);
    const suffix = Date.now().toString(36);
    const assetCode = `PCA-E2E-${suffix}`;

    const pump = await apiFetch(page, {
      path: '/api/pca-pumps',
      method: 'POST',
      body: {
        asset_code: assetCode,
        serial_number: `SER-E2E-${suffix}`,
        model_name: 'E2E PCA Pump',
        manufacturer: 'E2E Medical',
        status: 'available',
      },
    });
    expect(pump.status).toBe(201);
    expect(pump.body.data).toEqual(
      expect.objectContaining({
        asset_code: assetCode,
        status: 'available',
      }),
    );

    const rental = await apiFetch(page, {
      path: '/api/pca-pump-rentals',
      method: 'POST',
      body: {
        pump_id: pump.body.data.id,
        institution_id: IDS.institution,
        status: 'active',
        rented_at: '2026-06-08',
        due_at: '2026-06-30',
        rental_fee_yen: 12000,
      },
    });
    expect(rental.status).toBe(201);
    expect(rental.body.data).toEqual(
      expect.objectContaining({
        pump_id: pump.body.data.id,
        status: 'active',
        due_at: '2026-06-30',
        pump: expect.objectContaining({
          id: pump.body.data.id,
          status: 'rented',
        }),
      }),
    );

    const returned = await apiFetch(page, {
      path: `/api/pca-pump-rentals/${rental.body.data.id}`,
      method: 'PATCH',
      body: {
        status: 'returned',
        returned_at: '2026-06-20',
      },
    });
    expect(returned.status).toBe(200);
    expect(returned.body.data).toEqual(
      expect.objectContaining({
        id: rental.body.data.id,
        status: 'returned',
        returned_at: '2026-06-20',
      }),
    );

    const pumps = await apiFetch(page, {
      path: `/api/pca-pumps?q=${assetCode}`,
      method: 'GET',
    });
    expect(pumps.status).toBe(200);
    expect(pumps.body.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: pump.body.data.id,
          asset_code: assetCode,
          status: 'maintenance',
        }),
      ]),
    );

    expect(withoutExpectedValidationConsole(errors)).toEqual([]);
  });

  test('prescription intake blocks unconfirmed injections and accepts eligible outpatient injections', async ({
    context,
  }) => {
    const { page, errors } = await createApiPage(context);

    const blocked = await apiFetch(page, {
      path: '/api/prescription-intakes',
      method: 'POST',
      body: buildPrescriptionPayload({
        sourceType: 'paper',
        drugName: 'E2E院外不可確認用注射液',
        drugCode: '7999402A1015',
        receiptCode: '799940202',
      }),
    });
    expect(blocked.status).toBe(400);
    expect(blocked.body.message).toContain('外来/在宅自己注射として調剤可否が未確認');
    expect(blocked.body.details.blocked_lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          line_number: 1,
          drug_name: 'E2E院外不可確認用注射液',
          reason: expect.stringContaining('確認されていません'),
        }),
      ]),
    );

    const suffix = Date.now().toString(36);
    const allowed = await apiFetch(page, {
      path: '/api/prescription-intakes',
      method: 'POST',
      body: buildPrescriptionPayload({
        sourceType: 'fax',
        drugName: `E2E自己注射対象確認済み注射液 ${suffix}`,
        drugCode: '7999401A1010',
        receiptCode: '799940101',
      }),
    });
    expect(allowed.status).toBe(201);
    expect(allowed.body.lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          drug_code: '7999401A1010',
        }),
      ]),
    );

    expect(withoutExpectedValidationConsole(errors)).toEqual([]);
  });
});

async function createApiPage(context: BrowserContext) {
  const { page, errors } = await createInstrumentedPage(context, { captureHttpErrors: false });
  await openStableRoute(page, '/dashboard');
  return { page, errors };
}

async function apiFetch(
  page: Page,
  args: { path: string; method: 'GET' | 'POST' | 'PATCH'; body?: unknown },
) {
  return page.evaluate(
    async ({ path, method, body, orgId }) => {
      const response = await fetch(path, {
        method,
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          'x-org-id': orgId,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await response.text();
      return {
        status: response.status,
        body: text ? JSON.parse(text) : null,
      };
    },
    { ...args, orgId: ORG_ID },
  );
}

async function fetchBillingPreview(page: Page, caseId: string) {
  return apiFetch(page, {
    path: `/api/visit-schedule-proposals/billing-preview?case_id=${caseId}&proposed_date=2026-06-10&pharmacist_id=${USER_ID}`,
    method: 'GET',
  });
}

function buildPrescriptionPayload(args: {
  sourceType: 'paper' | 'fax';
  drugName: string;
  drugCode: string;
  receiptCode: string;
}) {
  return {
    case_id: IDS.prescriptionCase,
    patient_id: IDS.prescriptionPatient,
    source_type: args.sourceType,
    prescribed_date: '2026-06-08',
    prescriber_name: 'E2E処方医',
    prescriber_institution_id: IDS.institution,
    lines: [
      {
        line_number: 1,
        drug_name: args.drugName,
        drug_code: args.drugCode,
        dosage_form: '注射液',
        dose: '1キット',
        frequency: '週1回',
        days: 7,
        quantity: 1,
        unit: 'キット',
        route: 'injection',
        notes: `receipt_code:${args.receiptCode}`,
      },
    ],
  };
}

function withoutExpectedValidationConsole(errors: string[]) {
  return errors.filter(
    (message) =>
      !message.includes(
        'console:Failed to load resource: the server responded with a status of 400',
      ),
  );
}
