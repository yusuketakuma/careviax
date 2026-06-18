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

  it('keeps v7 data and stores p1_11 voice memo drafts after upgrading to the latest schema', async () => {
    const legacyDb = new Dexie('PH-OSOffline');
    legacyDb.version(7).stores({
      visitDrafts: '++id, scheduleId, patientId, synced',
      residualDrafts: '++id, patientId, synced',
      syncQueue: '++id, entityType, scope_id, retryCount, createdAt, conflict_state',
      visitBriefCache: '++id, scheduleId, scheduledDate, patientId, updatedAt',
      prescriptionDrafts: '++id, orgId, updatedAt',
      evidenceDrafts: '++id, scheduleId, patientId, createdAt',
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
    await legacyDb.table('evidenceDrafts').add({
      scheduleId: 'schedule-1',
      patientId: 'patient-1',
      category: 'residual_photo',
      fileName: 'residual.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 1024,
      payload: 'encv1:encrypted-data-url',
      capturedAt: new Date(),
      createdAt: new Date(),
      synced: false,
      retryCount: 0,
    });
    legacyDb.close();

    const { offlineDb } = await import('./offline-db');
    await offlineDb.open();

    expect(await offlineDb.visitDrafts.count()).toBe(1);
    expect(await offlineDb.evidenceDrafts.count()).toBe(1);

    await offlineDb.voiceMemoDrafts.add({
      visitId: 'visit-1',
      fileName: 'memo.webm',
      mimeType: 'audio/webm',
      sizeBytes: 2048,
      payload: 'encv1:encrypted-audio-data-url',
      durationSeconds: 12,
      recordedAt: new Date('2026-06-18T10:00:00.000Z'),
      createdAt: new Date('2026-06-18T10:00:00.000Z'),
      transcriptStatus: 'pending',
    });

    const draft = await offlineDb.voiceMemoDrafts.where('visitId').equals('visit-1').first();
    expect(draft).toMatchObject({
      visitId: 'visit-1',
      fileName: 'memo.webm',
      payload: 'encv1:encrypted-audio-data-url',
      transcriptStatus: 'pending',
    });
  });

  it('keeps v8 evidence data and exposes retry indexes after upgrading to v9', async () => {
    const legacyDb = new Dexie('PH-OSOffline');
    legacyDb.version(8).stores({
      visitDrafts: '++id, scheduleId, patientId, synced',
      residualDrafts: '++id, patientId, synced',
      syncQueue: '++id, entityType, scope_id, retryCount, createdAt, conflict_state',
      visitBriefCache: '++id, scheduleId, scheduledDate, patientId, updatedAt',
      prescriptionDrafts: '++id, orgId, updatedAt',
      evidenceDrafts: '++id, scheduleId, patientId, createdAt',
      voiceMemoDrafts: '++id, visitId, createdAt',
    });

    await legacyDb.open();
    await legacyDb.table('evidenceDrafts').bulkAdd([
      {
        scheduleId: 'schedule-1',
        patientId: 'patient-1',
        category: 'residual_photo',
        fileName: 'pending.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: 1024,
        payload: 'encv1:pending',
        capturedAt: new Date(),
        createdAt: new Date('2026-06-18T09:00:00.000Z'),
        synced: false,
        retryCount: 0,
        uploadedFileAssetId: 'file_existing',
        uploadedVisitRecordId: 'visit_record_1',
      },
      {
        scheduleId: 'schedule-2',
        patientId: 'patient-2',
        category: 'residual_photo',
        fileName: 'synced.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: 1024,
        payload: 'encv1:synced',
        capturedAt: new Date(),
        createdAt: new Date('2026-06-18T09:05:00.000Z'),
        synced: true,
        retryCount: 0,
      },
      {
        scheduleId: 'schedule-3',
        patientId: 'patient-3',
        category: 'residual_photo',
        fileName: 'failed.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: 1024,
        payload: 'encv1:failed',
        capturedAt: new Date(),
        createdAt: new Date('2026-06-18T09:10:00.000Z'),
        synced: false,
        retryCount: 3,
      },
      {
        scheduleId: 'schedule-4',
        patientId: 'patient-4',
        category: 'residual_photo',
        fileName: 'legacy-missing-retry.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: 1024,
        payload: 'encv1:legacy-missing-retry',
        capturedAt: new Date(),
        createdAt: new Date('2026-06-18T09:15:00.000Z'),
      },
    ]);
    await legacyDb.table('voiceMemoDrafts').add({
      visitId: 'visit-1',
      fileName: 'memo.webm',
      mimeType: 'audio/webm',
      sizeBytes: 2048,
      payload: 'encv1:audio',
      durationSeconds: 12,
      recordedAt: new Date('2026-06-18T10:00:00.000Z'),
      createdAt: new Date('2026-06-18T10:00:00.000Z'),
      transcriptStatus: 'pending',
    });
    legacyDb.close();

    const { offlineDb } = await import('./offline-db');
    await offlineDb.open();

    expect(await offlineDb.voiceMemoDrafts.count()).toBe(1);
    await expect(
      offlineDb.evidenceDrafts.where('retryCount').aboveOrEqual(0).count(),
    ).resolves.toBe(4);
    await expect(
      offlineDb.evidenceDrafts
        .where('retryCount')
        .below(3)
        .and((draft) => !draft.synced)
        .count(),
    ).resolves.toBe(2);
    await expect(
      offlineDb.evidenceDrafts.where('scheduleId').equals('schedule-1').first(),
    ).resolves.toMatchObject({
      retryCount: 0,
      uploadedFileAssetId: 'file_existing',
      uploadedVisitRecordId: 'visit_record_1',
    });
    await expect(
      offlineDb.evidenceDrafts.where('scheduleId').equals('schedule-4').first(),
    ).resolves.toMatchObject({
      retryCount: 0,
      synced: false,
    });
  });
});
