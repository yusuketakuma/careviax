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

  it('keeps v6 data and stores p0_48 evidence drafts after upgrading to v7', async () => {
    const legacyDb = new Dexie('PH-OSOffline');
    legacyDb.version(6).stores({
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
      createdAt: new Date(),
      updatedAt: new Date(),
      synced: false,
    });
    legacyDb.close();

    const { offlineDb } = await import('./offline-db');
    await offlineDb.open();

    // 既存テーブルのデータが保持される
    expect(await offlineDb.visitDrafts.count()).toBe(1);

    // 新テーブル evidenceDrafts に保存・参照できる
    await offlineDb.evidenceDrafts.add({
      scheduleId: 'schedule-1',
      patientId: 'patient-1',
      category: 'residual_photo',
      fileName: '残薬写真_20260613-103045.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 1024,
      payload: 'encv1:encrypted-data-url',
      capturedAt: new Date(),
      createdAt: new Date(),
      synced: false,
      retryCount: 0,
    });

    const draft = await offlineDb.evidenceDrafts.where('scheduleId').equals('schedule-1').first();
    expect(draft).toMatchObject({
      category: 'residual_photo',
      payload: 'encv1:encrypted-data-url',
      synced: false,
      retryCount: 0,
    });
  });
});
