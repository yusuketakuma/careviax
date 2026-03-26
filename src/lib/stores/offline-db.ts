import Dexie, { type Table } from 'dexie';

// Offline draft types
export type OfflineVisitDraft = {
  id?: number;
  scheduleId: string;
  patientId: string;
  pharmacistId: string;
  soapSubjective?: string;
  soapObjective?: string;
  soapAssessment?: string;
  soapPlan?: string;
  outcomeStatus?: string;
  receiptPersonName?: string;
  receiptPersonRelation?: string;
  /** JSON.stringify(StructuredSoap) — 暗号化対応可 */
  structuredSoap?: string;
  /** ウィザードの現在ステップ */
  currentStep?: number;
  createdAt: Date;
  updatedAt: Date;
  synced: boolean;
};

export type OfflineResidualDraft = {
  id?: number;
  patientId: string;
  caseId?: string;
  drugName: string;
  expectedDays: number;
  actualDays: number;
  excessDays: number;
  reason?: string;
  createdAt: Date;
  synced: boolean;
};

export type OfflineSyncQueue = {
  id?: number;
  entityType: 'visit_record' | 'residual_medication';
  payload: string; // encrypted JSON
  createdAt: Date;
  retryCount: number;
  lastError?: string;
};

class CareViaXOfflineDB extends Dexie {
  visitDrafts!: Table<OfflineVisitDraft, number>;
  residualDrafts!: Table<OfflineResidualDraft, number>;
  syncQueue!: Table<OfflineSyncQueue, number>;

  constructor() {
    super('CareViaXOffline');

    this.version(1).stores({
      visitDrafts: '++id, scheduleId, patientId, synced',
      residualDrafts: '++id, patientId, synced',
      syncQueue: '++id, entityType, createdAt',
    });

    this.version(2)
      .stores({
        visitDrafts: '++id, scheduleId, patientId, synced',
        residualDrafts: '++id, patientId, synced',
        syncQueue: '++id, entityType, createdAt',
      })
      .upgrade((tx) => {
        // v1→v2: 既存レコードに新フィールドのデフォルト値を設定
        return tx
          .table('visitDrafts')
          .toCollection()
          .modify((draft: OfflineVisitDraft) => {
            if (draft.currentStep === undefined) draft.currentStep = 0;
          });
      });
  }
}

export const offlineDb = new CareViaXOfflineDB();
