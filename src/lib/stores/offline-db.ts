import Dexie, { type Table } from 'dexie';

type LegacyPlaintextSoapDraftFields = {
  soapSubjective?: string;
  soapObjective?: string;
  soapAssessment?: string;
  soapPlan?: string;
};

// Offline draft types
export type OfflineVisitDraft = {
  id?: number;
  scheduleId: string;
  patientId: string;
  pharmacistId: string;
  visitDate?: string;
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

function purgeLegacyPlaintextSoapDraftFields(
  draft: OfflineVisitDraft & LegacyPlaintextSoapDraftFields,
) {
  delete draft.soapSubjective;
  delete draft.soapObjective;
  delete draft.soapAssessment;
  delete draft.soapPlan;
}

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

export type OfflinePrescriptionDraft = {
  id?: number;
  orgId: string;
  payload: string; // encrypted JSON of form state snapshot
  createdAt: Date;
  updatedAt: Date;
};

/** p0_48 モバイル証跡撮影の写真ドラフト(通信がなくても端末に保存→復帰時に自動送信) */
export type OfflineEvidenceDraft = {
  id?: number;
  /** 撮影画面を開いた訪問(visit-schedule)ID */
  scheduleId: string;
  patientId?: string;
  /** p0_33 証跡 6 区分の ID(p0_48 チップはそのサブセット) */
  category: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  /** encryptOfflinePayloadRequired で暗号化した画像 dataURL(PHI のため平文保存しない) */
  payload: string;
  capturedAt: Date;
  createdAt: Date;
  synced: boolean;
  retryCount: number;
  lastError?: string;
  /** Uploaded file asset id retained so retry can resume attachment without re-uploading PHI. */
  uploadedFileAssetId?: string;
  uploadedVisitRecordId?: string;
};

/**
 * p1_11 音声メモ・文字起こしの録音ドラフト(端末保存)。
 * 文字起こしエンジン(STT)は外部サービス接続後のため、第一版は
 * transcriptStatus='pending'(転写待ち)のまま端末にのみ保持する。
 */
export type OfflineVoiceMemoDraft = {
  id?: number;
  /** 録音画面を開いた訪問(visit-schedule または visit-record)ID */
  visitId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  /** encryptOfflinePayloadRequired で暗号化した音声 dataURL(PHI のため平文保存しない) */
  payload: string;
  durationSeconds: number;
  recordedAt: Date;
  createdAt: Date;
  /** 転写状態(第一版は外部 STT 未接続のため 'pending' のみ) */
  transcriptStatus: 'pending' | 'done';
};

class PhOsOfflineDB extends Dexie {
  visitDrafts!: Table<OfflineVisitDraft, number>;
  residualDrafts!: Table<OfflineResidualDraft, number>;
  syncQueue!: Table<OfflineSyncQueue, number>;
  visitBriefCache!: Table<OfflineVisitBriefCache, number>;
  prescriptionDrafts!: Table<OfflinePrescriptionDraft, number>;
  evidenceDrafts!: Table<OfflineEvidenceDraft, number>;
  voiceMemoDrafts!: Table<OfflineVoiceMemoDraft, number>;

  constructor() {
    super('PH-OSOffline');

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

    this.version(5).stores({
      visitDrafts: '++id, scheduleId, patientId, synced',
      residualDrafts: '++id, patientId, synced',
      syncQueue: '++id, entityType, scope_id, retryCount, createdAt, conflict_state',
      visitBriefCache: '++id, scheduleId, scheduledDate, patientId, updatedAt',
      prescriptionDrafts: '++id, orgId, updatedAt',
    });

    this.version(6)
      .stores({
        visitDrafts: '++id, scheduleId, patientId, synced',
        residualDrafts: '++id, patientId, synced',
        syncQueue: '++id, entityType, scope_id, retryCount, createdAt, conflict_state',
        visitBriefCache: '++id, scheduleId, scheduledDate, patientId, updatedAt',
        prescriptionDrafts: '++id, orgId, updatedAt',
      })
      .upgrade((tx) =>
        tx
          .table('visitDrafts')
          .toCollection()
          .modify((draft: OfflineVisitDraft & LegacyPlaintextSoapDraftFields) => {
            purgeLegacyPlaintextSoapDraftFields(draft);
          }),
      );

    // v7: p0_48 モバイル証跡撮影の写真ドラフト(暗号化 dataURL)を追加
    this.version(7).stores({
      visitDrafts: '++id, scheduleId, patientId, synced',
      residualDrafts: '++id, patientId, synced',
      syncQueue: '++id, entityType, scope_id, retryCount, createdAt, conflict_state',
      visitBriefCache: '++id, scheduleId, scheduledDate, patientId, updatedAt',
      prescriptionDrafts: '++id, orgId, updatedAt',
      evidenceDrafts: '++id, scheduleId, patientId, createdAt',
    });

    // v8: p1_11 音声メモの録音ドラフト(暗号化 dataURL、転写待ち)を追加
    this.version(8).stores({
      visitDrafts: '++id, scheduleId, patientId, synced',
      residualDrafts: '++id, patientId, synced',
      syncQueue: '++id, entityType, scope_id, retryCount, createdAt, conflict_state',
      visitBriefCache: '++id, scheduleId, scheduledDate, patientId, updatedAt',
      prescriptionDrafts: '++id, orgId, updatedAt',
      evidenceDrafts: '++id, scheduleId, patientId, createdAt',
      voiceMemoDrafts: '++id, visitId, createdAt',
    });
  }
}

export const offlineDb = new PhOsOfflineDB();
