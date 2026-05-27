import 'fake-indexeddb/auto';

import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('offline DB migrations', () => {
  beforeEach(async () => {
    vi.resetModules();
    await indexedDB.deleteDatabase('PH-OSOffline');
  });

  afterEach(async () => {
    const { offlineDb } = await import('./offline-db');
    offlineDb.close();
    await indexedDB.deleteDatabase('PH-OSOffline');
  });

  it('purges legacy plaintext SOAP draft fields when upgrading to v6', async () => {
    const legacyDb = new Dexie('PH-OSOffline');
    legacyDb.version(5).stores({
      visitDrafts: '++id, scheduleId, patientId, synced',
      residualDrafts: '++id, patientId, synced',
      syncQueue: '++id, entityType, scope_id, retryCount, createdAt, conflict_state',
      visitBriefCache: '++id, scheduleId, scheduledDate, patientId, updatedAt',
      prescriptionDrafts: '++id, orgId, updatedAt',
    });

    await legacyDb.open();
    await legacyDb.table('visitDrafts').add({
      scheduleId: 'schedule-1',
      patientId: 'patient-1',
      pharmacistId: 'pharmacist-1',
      structuredSoap: 'encv1:encrypted-structured-soap',
      soapSubjective: '患者名 山田太郎 S plaintext',
      soapObjective: 'O plaintext',
      soapAssessment: 'A plaintext',
      soapPlan: 'P plaintext',
      createdAt: new Date(),
      updatedAt: new Date(),
      synced: false,
    });
    legacyDb.close();

    const { offlineDb } = await import('./offline-db');
    await offlineDb.open();
    const migrated = await offlineDb.visitDrafts.where('scheduleId').equals('schedule-1').first();

    expect(migrated).toMatchObject({
      scheduleId: 'schedule-1',
      patientId: 'patient-1',
      structuredSoap: 'encv1:encrypted-structured-soap',
    });
    expect(migrated).not.toHaveProperty('soapSubjective');
    expect(migrated).not.toHaveProperty('soapObjective');
    expect(migrated).not.toHaveProperty('soapAssessment');
    expect(migrated).not.toHaveProperty('soapPlan');
  });
});
