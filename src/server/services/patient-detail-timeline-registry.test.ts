import { describe, expect, it, vi } from 'vitest';

import {
  careReportsSource,
  medicationStockSnapshotsSource,
  operationalTasksSource,
  selfReportsSource,
  visitRecordsSource,
  type PatientTimelineRegistryDb,
  type TimelineFetchCtx,
} from './patient-detail-timeline-registry';

function findManyDelegate() {
  return {
    findMany: vi.fn().mockResolvedValue([]),
  };
}

function createDb() {
  return {
    billingCandidate: findManyDelegate(),
    careReport: findManyDelegate(),
    communicationEvent: findManyDelegate(),
    conferenceNote: findManyDelegate(),
    dispenseResult: findManyDelegate(),
    externalAccessGrant: findManyDelegate(),
    firstVisitDocument: findManyDelegate(),
    inquiryRecord: findManyDelegate(),
    managementPlan: findManyDelegate(),
    patientSelfReport: findManyDelegate(),
    patientMcsMessage: findManyDelegate(),
    partnerVisitRecord: findManyDelegate(),
    residualMedication: findManyDelegate(),
    medicationStockSnapshot: findManyDelegate(),
    task: findManyDelegate(),
    prescriptionIntake: findManyDelegate(),
    visitRecord: findManyDelegate(),
    visitSchedule: findManyDelegate(),
  } as unknown as PatientTimelineRegistryDb;
}

function createCtx(db: PatientTimelineRegistryDb): TimelineFetchCtx {
  return {
    db,
    orgId: 'org_1',
    patientId: 'patient_1',
    caseIds: ['case_1'],
    timelineLimit: 5,
    canManageBilling: false,
    billingRefs: { visitRecordIds: [], cycleIds: [] },
  };
}

describe('patient-detail-timeline-registry query shapes', () => {
  it('keeps visit record source bounded, scoped, selected, and stable', async () => {
    const db = createDb();

    await visitRecordsSource.fetch(createCtx(db));

    expect(db.visitRecord.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          patient_id: 'patient_1',
        }),
        orderBy: [{ visit_date: 'desc' }, { created_at: 'desc' }, { id: 'desc' }],
        take: 5,
        select: expect.objectContaining({
          id: true,
          visit_date: true,
          outcome_status: true,
          created_at: true,
        }),
      }),
    );
    expect(vi.mocked(db.visitRecord.findMany).mock.calls[0]?.[0]).not.toHaveProperty('include');
  });

  it('keeps care report source bounded with selected nested delivery records', async () => {
    const db = createDb();

    await careReportsSource.fetch(createCtx(db));

    expect(db.careReport.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          patient_id: 'patient_1',
        }),
        orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
        take: 8,
        select: expect.objectContaining({
          id: true,
          report_type: true,
          status: true,
          delivery_records: expect.objectContaining({
            orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
            take: 4,
            select: expect.objectContaining({
              id: true,
              channel: true,
              status: true,
            }),
          }),
        }),
      }),
    );
    expect(vi.mocked(db.careReport.findMany).mock.calls[0]?.[0]).not.toHaveProperty('include');
  });

  it('keeps task and self-report sources bounded and patient/case scoped', async () => {
    const db = createDb();
    const ctx = createCtx(db);

    await operationalTasksSource.fetch(ctx);
    await selfReportsSource.fetch(ctx);

    expect(db.task.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          org_id: 'org_1',
          OR: [
            {
              related_entity_type: 'patient',
              related_entity_id: 'patient_1',
            },
            {
              related_entity_type: 'case',
              related_entity_id: {
                in: ['case_1'],
              },
            },
          ],
        },
        orderBy: [{ updated_at: 'desc' }, { created_at: 'desc' }, { id: 'desc' }],
        take: 12,
      }),
    );
    expect(db.patientSelfReport.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          org_id: 'org_1',
          patient_id: 'patient_1',
        },
        orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
        take: 5,
      }),
    );
  });

  it('keeps medication stock snapshot source bounded, case scoped, and PHI-minimized', async () => {
    const db = createDb();

    await medicationStockSnapshotsSource.fetch(createCtx(db));

    expect(db.medicationStockSnapshot.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          org_id: 'org_1',
          patient_id: 'patient_1',
          case_id: { in: ['case_1'] },
          stock_risk_level: { in: ['urgent', 'shortage_expected'] },
        },
        orderBy: [
          { estimated_stockout_date: 'asc' },
          { days_until_stockout: 'asc' },
          { calculated_at: 'desc' },
          { id: 'asc' },
        ],
        take: 5,
        select: {
          id: true,
          stock_risk_level: true,
          calculated_at: true,
        },
      }),
    );
    const query = vi.mocked(db.medicationStockSnapshot.findMany).mock.calls[0]?.[0];
    expect(query).not.toHaveProperty('include');
    expect(JSON.stringify(query)).not.toContain('stock_item_id');
    expect(JSON.stringify(query)).not.toContain('current_quantity');
    expect(JSON.stringify(query)).not.toContain('risk_reason_code');
  });

  it('does not read medication stock snapshots without visible case scope', async () => {
    const db = createDb();

    await medicationStockSnapshotsSource.fetch({
      ...createCtx(db),
      caseIds: [],
    });

    expect(db.medicationStockSnapshot.findMany).not.toHaveBeenCalled();
  });

  it('projects medication stock snapshots as generic movement markers', () => {
    const [event] = medicationStockSnapshotsSource.toEvents(
      [
        {
          id: 'snapshot_1',
          stock_risk_level: 'urgent',
          calculated_at: new Date('2026-07-08T01:00:00.000Z'),
          stock_item_id: 'stock_item_1',
          current_quantity: '12',
          unit: 'tablet',
          risk_reason_code: 'raw_reason',
        } as never,
      ],
      {
        patientId: 'patient_1',
        actorNameMap: new Map(),
        firstVisitDocumentActions: new Map(),
        hrefs: {
          patientDetailHref: '/patients/patient_1',
          patientMedicationHref: '/patients/patient_1#card-prescription-section',
          patientDocumentsHref: '/patients/patient_1#patient-documents',
          patientManagementPlanHref: '/patients/patient_1/management-plan',
          patientMcsHref: '/patients/patient_1/mcs',
          patientCollaborationHref: '/patients/patient_1/collaboration',
          patientShareHref: '/patients/patient_1/share',
          patientBillingCandidatesHref: '/billing/candidates?patient_id=patient_1',
          patientConferencesHref: '/conferences?patient_id=patient_1',
        },
      },
    );

    expect(event).toMatchObject({
      id: 'medication_stock_snapshot:snapshot_1',
      event_type: 'medication_stock_snapshot',
      category: 'medication_stock',
      title: '残数不足リスクを検出',
      summary: '現在の残数予測で不足リスクがあります。内容は薬剤・訪問で確認してください。',
      href: '/patients/patient_1#card-prescription-section',
      action_label: '残数を確認',
      status: 'urgent',
      status_label: '至急',
      actor_name: null,
      metadata: [],
    });
    const serialized = JSON.stringify(event);
    expect(serialized).not.toContain('stock_item_1');
    expect(serialized).not.toContain('current_quantity');
    expect(serialized).not.toContain('tablet');
    expect(serialized).not.toContain('raw_reason');
  });
});
