import { describe, expect, it, vi } from 'vitest';

import {
  careReportsSource,
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
});
