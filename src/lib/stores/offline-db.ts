import Dexie, { type Table } from 'dexie';

// Offline draft types
export type OfflineVisitDraft = {
  id?: number;
  scheduleId: string;
  patientId: string;
  pharmacistId: string;
  visitDate?: string;
  soapSubjective?: string;
  soapObjective?: string;
  soapAssessment?: string;
  soapPlan?: string;
  outcomeStatus?: string;
  receiptPersonName?: string;
  receiptPersonRelation?: string;
  receiptAt?: string;
  nextVisitSuggestionDate?: string;
  cancellationReason?: string;
  postponeReason?: string;
  revisitReason?: string;
  visitGeoLog?: string;
  /** JSON.stringify(StructuredSoap) — 暗号化対応可 */
  structuredSoap?: string;
  /** JSON.stringify(Form residual medications) */
  residualMedications?: string;
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
  scope_id?: string;
  createdAt: Date;
  retryCount: number;
  lastError?: string;
  conflict_state?: 'server_conflict';
  conflict_payload?: string;
};

export type OfflineVisitBriefCache = {
  id?: number;
  scheduleId: string;
  patientId: string;
  scheduledDate: string;
  payload: string;
  updatedAt: Date;
};

class CareViaXOfflineDB extends Dexie {
  visitDrafts!: Table<OfflineVisitDraft, number>;
  residualDrafts!: Table<OfflineResidualDraft, number>;
  syncQueue!: Table<OfflineSyncQueue, number>;
  visitBriefCache!: Table<OfflineVisitBriefCache, number>;

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

    this.version(3).stores({
      visitDrafts: '++id, scheduleId, patientId, synced',
      residualDrafts: '++id, patientId, synced',
      syncQueue: '++id, entityType, scope_id, createdAt, conflict_state',
      visitBriefCache: '++id, scheduleId, scheduledDate, patientId, updatedAt',
    });

    this.version(4).stores({
      visitDrafts: '++id, scheduleId, patientId, synced',
      residualDrafts: '++id, patientId, synced',
      syncQueue: '++id, entityType, scope_id, retryCount, createdAt, conflict_state',
      visitBriefCache: '++id, scheduleId, scheduledDate, patientId, updatedAt',
    });
  }
}

export const offlineDb = new CareViaXOfflineDB();
