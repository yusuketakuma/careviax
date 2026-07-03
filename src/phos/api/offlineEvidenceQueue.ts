'use client';

import Dexie, { type Table } from 'dexie';
import { decryptOfflinePayload, encryptOfflinePayloadRequired } from '@/lib/offline/crypto';
import { arrayBufferToBase64, base64ToArrayBuffer } from '@/lib/utils/base64';
import { normalizePositiveTimeoutMs } from '@/lib/utils/timeout';
import {
  VisitStep,
  type EvidencePendingView,
  type OfflineOpClass,
  type VisitModeView,
} from '@/phos/contracts/phos_contracts';
import type { PhosApiClient } from './types';
import { createPhosRequestAbort } from './request-timeout';

export const MAX_RETRIES = 3;
const UNREADABLE_EVIDENCE_PAYLOAD_ERROR = 'EVIDENCE_PAYLOAD_UNREADABLE';
const UNREADABLE_EVIDENCE_LABEL = '未同期証跡（復旧が必要）';
const DEFAULT_EVIDENCE_UPLOAD_TIMEOUT_MS = 30_000;
const MAX_EVIDENCE_UPLOAD_TIMEOUT_MS = 120_000;
export const PHOS_OFFLINE_EVIDENCE_REPLAY_BATCH_SIZE = 10;
export const MAX_OFFLINE_EVIDENCE_FILE_SIZE_BYTES = 25 * 1024 * 1024;
export const MAX_OFFLINE_EVIDENCE_QUEUE_BYTES = 75 * 1024 * 1024;
let activeEvidenceUploadReplay: Promise<{
  synced: number;
  failed: number;
  verified_visits: VisitModeView[];
}> | null = null;

export type PhosOfflineEvidenceInput = {
  card_id: string;
  packet_id: string;
  evidence_key: string;
  label: string;
  evidence_type: string;
  file_name: string;
  mime_type: string;
  sha256: string;
  offline_op_class: OfflineOpClass;
  file: Blob;
};

export type PhosOfflineEvidenceRecord = {
  id?: number;
  card_id: string;
  packet_id: string;
  evidence_key: string;
  offline_op_class: OfflineOpClass;
  payload?: string;
  size_bytes: number;
  created_at: string;
  retry_count: number;
  last_error?: string;
};

type EncryptedEvidencePayload = {
  label: string;
  evidence_type: string;
  file_name: string;
  mime_type: string;
  sha256: string;
  file_bytes_base64: string;
  size_bytes: number;
};

type QueuedEvidencePayloadReadResult =
  | { status: 'available'; payload: EncryptedEvidencePayload }
  | { status: 'legacy-deleted' }
  | { status: 'unreadable' };

type ReplayEvidencePayload =
  | { status: 'available'; payload: EncryptedEvidencePayload; file_bytes: ArrayBuffer }
  | { status: 'unreadable' };

class PhosOfflineEvidenceDb extends Dexie {
  pendingEvidence!: Table<PhosOfflineEvidenceRecord, number>;

  constructor() {
    super('PH-OSEvidenceOfflineQueue');

    this.version(1).stores({
      pendingEvidence:
        '++id, card_id, packet_id, evidence_key, offline_op_class, created_at, retry_count',
    });
    this.version(2)
      .stores({
        pendingEvidence:
          '++id, card_id, packet_id, evidence_key, offline_op_class, created_at, retry_count',
      })
      .upgrade((tx) => tx.table('pendingEvidence').clear());
  }
}

export const phosOfflineEvidenceDb = new PhosOfflineEvidenceDb();

function assertBlobEvidence(input: PhosOfflineEvidenceInput): void {
  if (!(input.file instanceof Blob)) {
    throw new Error('PH-OS offline evidence must be stored as a Blob');
  }
  if (input.file.size <= 0) {
    throw new Error('PH-OS offline evidence file is empty');
  }
  if (input.file.type.startsWith('text/') || input.mime_type.startsWith('text/')) {
    throw new Error('PH-OS offline evidence must not store base64 or text payloads');
  }
}

async function assertOfflineEvidenceQuota(input: PhosOfflineEvidenceInput): Promise<void> {
  if (input.file.size > MAX_OFFLINE_EVIDENCE_FILE_SIZE_BYTES) {
    throw new Error('PH-OS offline evidence file exceeds the offline size limit');
  }

  const records = await phosOfflineEvidenceDb.pendingEvidence.toArray();
  const queuedBytes = records.reduce((total, record) => total + record.size_bytes, 0);
  if (queuedBytes + input.file.size > MAX_OFFLINE_EVIDENCE_QUEUE_BYTES) {
    throw new Error('PH-OS offline evidence queue exceeds the offline storage limit');
  }
}

function isEncryptedEvidencePayload(value: unknown): value is EncryptedEvidencePayload {
  return (
    !!value &&
    typeof value === 'object' &&
    typeof (value as EncryptedEvidencePayload).label === 'string' &&
    typeof (value as EncryptedEvidencePayload).evidence_type === 'string' &&
    typeof (value as EncryptedEvidencePayload).file_name === 'string' &&
    typeof (value as EncryptedEvidencePayload).mime_type === 'string' &&
    typeof (value as EncryptedEvidencePayload).sha256 === 'string' &&
    typeof (value as EncryptedEvidencePayload).file_bytes_base64 === 'string' &&
    typeof (value as EncryptedEvidencePayload).size_bytes === 'number'
  );
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(bytes: ArrayBuffer): Promise<string | null> {
  const cryptoApi =
    typeof window !== 'undefined' && window.crypto?.subtle ? window.crypto : globalThis.crypto;
  if (!cryptoApi?.subtle) return null;
  const digest = await cryptoApi.subtle.digest('SHA-256', bytes);
  return bytesToHex(new Uint8Array(digest));
}

async function prepareReplayEvidencePayload(
  payload: EncryptedEvidencePayload,
): Promise<ReplayEvidencePayload> {
  if (
    !Number.isSafeInteger(payload.size_bytes) ||
    payload.size_bytes <= 0 ||
    !/^[a-f0-9]{64}$/i.test(payload.sha256)
  ) {
    return { status: 'unreadable' };
  }

  let fileBytes: ArrayBuffer;
  try {
    fileBytes = base64ToArrayBuffer(payload.file_bytes_base64);
  } catch {
    return { status: 'unreadable' };
  }

  if (fileBytes.byteLength !== payload.size_bytes) return { status: 'unreadable' };
  const digest = await sha256Hex(fileBytes);
  if (!digest || digest !== payload.sha256.toLowerCase()) return { status: 'unreadable' };

  return { status: 'available', payload, file_bytes: fileBytes };
}

async function encryptEvidencePayload(input: {
  evidence: PhosOfflineEvidenceInput;
  file_bytes: ArrayBuffer;
}): Promise<string> {
  return encryptOfflinePayloadRequired(
    JSON.stringify({
      label: input.evidence.label,
      evidence_type: input.evidence.evidence_type,
      file_name: input.evidence.file_name,
      mime_type: input.evidence.mime_type,
      sha256: input.evidence.sha256,
      file_bytes_base64: arrayBufferToBase64(input.file_bytes),
      size_bytes: input.evidence.file.size,
    } satisfies EncryptedEvidencePayload),
    'PH-OS offline evidence payload',
  );
}

async function deleteLegacyPlaintextRecord(record: PhosOfflineEvidenceRecord): Promise<boolean> {
  if (typeof record.payload === 'string') return false;
  if (record.id !== undefined) await phosOfflineEvidenceDb.pendingEvidence.delete(record.id);
  return true;
}

async function readQueuedEvidencePayload(
  record: PhosOfflineEvidenceRecord,
): Promise<QueuedEvidencePayloadReadResult> {
  if (await deleteLegacyPlaintextRecord(record)) return { status: 'legacy-deleted' };
  const decrypted = await decryptOfflinePayload(record.payload);
  if (!decrypted) return { status: 'unreadable' };
  try {
    const parsed = JSON.parse(decrypted) as unknown;
    return isEncryptedEvidencePayload(parsed)
      ? { status: 'available', payload: parsed }
      : { status: 'unreadable' };
  } catch {
    return { status: 'unreadable' };
  }
}

function safeRetryError(error: unknown): string {
  if (error instanceof Error && /^Evidence upload failed with HTTP \d{3}$/.test(error.message)) {
    return error.message;
  }
  return 'EVIDENCE_UPLOAD_RETRY_FAILED';
}

function assertSafeEvidenceUploadUrl(uploadUrl: string): void {
  let parsed: URL;
  try {
    parsed = new URL(uploadUrl);
  } catch {
    throw new Error('PH-OS evidence upload URL must be an absolute http(s) URL');
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('PH-OS evidence upload URL must use http(s)');
  }
  const localHttpHosts = new Set(['localhost', '127.0.0.1', '[::1]']);
  if (parsed.protocol === 'http:' && !localHttpHosts.has(parsed.hostname)) {
    throw new Error('PH-OS evidence upload URL must use https outside local development');
  }
  if (parsed.username || parsed.password || parsed.hash) {
    throw new Error('PH-OS evidence upload URL must not include credentials or fragment');
  }
}

async function putEvidenceUpload(input: {
  fetchImpl: typeof fetch;
  upload_url: string;
  method: string;
  headers: Record<string, string>;
  body: Blob;
  timeoutMs?: number;
  signal?: AbortSignal;
}): Promise<Response> {
  assertSafeEvidenceUploadUrl(input.upload_url);
  if (input.method !== 'PUT') {
    throw new Error('PH-OS evidence upload URL must use PUT');
  }
  const effectiveTimeoutMs = normalizePositiveTimeoutMs(input.timeoutMs, {
    fallbackMs: DEFAULT_EVIDENCE_UPLOAD_TIMEOUT_MS,
    maxMs: MAX_EVIDENCE_UPLOAD_TIMEOUT_MS,
  });
  const uploadAbort = createPhosRequestAbort({
    timeoutMs: effectiveTimeoutMs,
    timeoutReason: new Error('PHOS_EVIDENCE_UPLOAD_TIMEOUT'),
    callerSignal: input.signal,
  });
  try {
    return await input.fetchImpl(input.upload_url, {
      method: input.method,
      headers: input.headers,
      body: input.body,
      credentials: 'omit',
      redirect: 'error',
      signal: uploadAbort.signal,
    });
  } catch (error) {
    if (uploadAbort.didTimeout()) {
      throw new Error('PH-OS evidence upload timed out');
    }
    throw error;
  } finally {
    uploadAbort.clear();
  }
}

export async function enqueuePhosOfflineEvidence(
  input: PhosOfflineEvidenceInput,
): Promise<{ queue_id: number }> {
  assertBlobEvidence(input);
  await assertOfflineEvidenceQuota(input);
  const file_bytes = await input.file.arrayBuffer();
  const payload = await encryptEvidencePayload({ evidence: input, file_bytes });
  const id = await phosOfflineEvidenceDb.pendingEvidence.add({
    card_id: input.card_id,
    packet_id: input.packet_id,
    evidence_key: input.evidence_key,
    offline_op_class: input.offline_op_class,
    payload,
    size_bytes: input.file.size,
    created_at: new Date().toISOString(),
    retry_count: 0,
  });
  return { queue_id: id };
}

export async function listPhosPendingEvidence(packet_id: string): Promise<EvidencePendingView[]> {
  const records = await phosOfflineEvidenceDb.pendingEvidence
    .where('packet_id')
    .equals(packet_id)
    .toArray();
  const views: EvidencePendingView[] = [];
  for (const record of records) {
    const readResult = await readQueuedEvidencePayload(record);
    if (readResult.status === 'legacy-deleted') continue;
    if (
      readResult.status === 'unreadable' ||
      record.last_error === UNREADABLE_EVIDENCE_PAYLOAD_ERROR
    ) {
      views.push({
        evidence_key: record.evidence_key,
        label: UNREADABLE_EVIDENCE_LABEL,
        offline_op_class: record.offline_op_class,
        created_at: record.created_at,
        retry_count: record.retry_count,
        last_error: record.last_error ?? UNREADABLE_EVIDENCE_PAYLOAD_ERROR,
      });
      continue;
    }
    const { payload } = readResult;
    views.push({
      evidence_key: record.evidence_key,
      label: payload.label,
      offline_op_class: record.offline_op_class,
      created_at: record.created_at,
      retry_count: record.retry_count,
      ...(record.last_error ? { last_error: record.last_error } : {}),
    });
  }
  return views;
}

async function markUnreadableEvidencePayload(record: PhosOfflineEvidenceRecord): Promise<void> {
  if (record.id === undefined) return;
  await phosOfflineEvidenceDb.pendingEvidence.update(record.id, {
    retry_count: record.retry_count + 1,
    last_error: UNREADABLE_EVIDENCE_PAYLOAD_ERROR,
  });
}

async function readNextOfflineEvidenceReplayBatch(
  afterId: number,
): Promise<PhosOfflineEvidenceRecord[]> {
  return phosOfflineEvidenceDb.pendingEvidence
    .where(':id')
    .above(afterId)
    .limit(PHOS_OFFLINE_EVIDENCE_REPLAY_BATCH_SIZE)
    .toArray();
}

async function retryPhosOfflineEvidenceUploadsOnce(input: {
  client: Pick<PhosApiClient, 'getVisitMode' | 'presignEvidenceUpload' | 'updateVisitStep'>;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  uploadTimeoutMs?: number;
}): Promise<{ synced: number; failed: number; verified_visits: VisitModeView[] }> {
  const fetchImpl = input.fetchImpl ?? fetch;
  let synced = 0;
  let failed = 0;
  let afterId = 0;
  const verifiedVisits = new Map<string, VisitModeView>();

  while (true) {
    const records = await readNextOfflineEvidenceReplayBatch(afterId);
    if (records.length === 0) break;
    afterId = records.reduce((maxId, record) => Math.max(maxId, record.id ?? maxId), afterId);

    for (const record of records) {
      if (record.id === undefined || record.retry_count >= MAX_RETRIES) continue;
      try {
        const readResult = await readQueuedEvidencePayload(record);
        if (readResult.status === 'legacy-deleted') continue;
        if (readResult.status === 'unreadable') {
          failed++;
          await markUnreadableEvidencePayload(record);
          continue;
        }
        const replayPayload = await prepareReplayEvidencePayload(readResult.payload);
        if (replayPayload.status === 'unreadable') {
          failed++;
          await markUnreadableEvidencePayload(record);
          continue;
        }
        const { payload } = replayPayload;
        const presigned = await input.client.presignEvidenceUpload({
          idempotency_key: `evidence_${record.packet_id}_${record.evidence_key}`,
          card_id: record.card_id,
          evidence_type: payload.evidence_type,
          file_name: payload.file_name,
          mime_type: payload.mime_type,
          sha256: payload.sha256,
          size_bytes: payload.size_bytes,
        });
        const response = await putEvidenceUpload({
          fetchImpl,
          upload_url: presigned.upload_url,
          method: presigned.method,
          headers: presigned.headers,
          body: new Blob([replayPayload.file_bytes], {
            type: payload.mime_type,
          }),
          signal: input.signal,
          timeoutMs: input.uploadTimeoutMs,
        });
        if (!response.ok) throw new Error(`Evidence upload failed with HTTP ${response.status}`);
        const visit = await input.client.getVisitMode(record.packet_id);
        const verifiedVisit = await input.client.updateVisitStep(
          record.packet_id,
          VisitStep.EVIDENCE_UPLOAD,
          {
            idempotency_key: `evidence_verify_${record.packet_id}_${record.evidence_key}_${presigned.evidence_id}`,
            client_version: visit.server_version,
            payload: { evidence_key: presigned.evidence_id },
          },
        );
        verifiedVisits.set(record.packet_id, verifiedVisit);
        await phosOfflineEvidenceDb.pendingEvidence.delete(record.id);
        synced++;
      } catch (error) {
        failed++;
        await phosOfflineEvidenceDb.pendingEvidence.update(record.id, {
          retry_count: record.retry_count + 1,
          last_error: safeRetryError(error),
        });
      }
    }
  }

  return { synced, failed, verified_visits: [...verifiedVisits.values()] };
}

export async function retryPhosOfflineEvidenceUploads(input: {
  client: Pick<PhosApiClient, 'getVisitMode' | 'presignEvidenceUpload' | 'updateVisitStep'>;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  uploadTimeoutMs?: number;
}): Promise<{ synced: number; failed: number; verified_visits: VisitModeView[] }> {
  if (activeEvidenceUploadReplay) return activeEvidenceUploadReplay;

  const replay = retryPhosOfflineEvidenceUploadsOnce(input).finally(() => {
    activeEvidenceUploadReplay = null;
  });
  activeEvidenceUploadReplay = replay;
  return replay;
}

/**
 * リトライ上限(MAX_RETRIES)に達して replay から永続的にスキップされる未同期証跡を
 * 再送対象へ戻す(利用者の「再試行」操作用)。
 *
 * MAX_RETRIES に達した BLOCKING 証跡は listPhosPendingEvidence 経由で blockingUnsyncedCount に
 * 加算され、canCompleteVisit が 0 を要求するため、その端末の訪問完了(COMPLETE_VISIT)を
 * 恒久ブロックする。医療データのため破棄はせず、retry_count をリセットして次回 replay で
 * 再試行できるようにすることで stuck を解消する。
 *
 * @param packet_id 指定時はその訪問のみ、省略時は全 stuck レコードが対象。
 * @returns 再送対象へ戻した件数。
 */
export async function resetStuckPhosOfflineEvidence(packet_id?: string): Promise<number> {
  const stuckRecords = await phosOfflineEvidenceDb.pendingEvidence
    .where('retry_count')
    .aboveOrEqual(MAX_RETRIES)
    .toArray();
  const targets = stuckRecords.filter(
    (record) =>
      record.id !== undefined && (packet_id === undefined || record.packet_id === packet_id),
  );
  await Promise.all(
    targets.map((record) =>
      phosOfflineEvidenceDb.pendingEvidence.update(record.id!, {
        retry_count: 0,
        last_error: undefined,
      }),
    ),
  );
  return targets.length;
}

export type PhosOfflineEvidenceDiscardInput = {
  packet_id: string;
  evidence_key: string;
  /** 確認ダイアログ相当の明示同意。true 以外では破棄しない(fail-closed)。 */
  acknowledged: boolean;
};

/**
 * 復旧不能な未同期証跡を、利用者の明示操作でのみ破棄する(dead-letter)。
 *
 * 医療データを勝手に破棄しないため、acknowledged=true(確認ダイアログ相当)を必須とする。
 * 破棄は取消不能なので、監査可能な構造化ログを残す。PHI は暗号化 payload に閉じているため、
 * ログには識別子・retry_count・last_error のみを出力し、患者データ本体は出力しない。
 *
 * @returns 破棄した場合 true、対象レコードが存在しない場合 false。
 */
export async function discardStuckPhosOfflineEvidence(
  input: PhosOfflineEvidenceDiscardInput,
): Promise<boolean> {
  if (input.acknowledged !== true) {
    throw new Error('PH-OS offline evidence discard requires explicit acknowledgement');
  }
  const record = await phosOfflineEvidenceDb.pendingEvidence
    .where('packet_id')
    .equals(input.packet_id)
    .and((candidate) => candidate.evidence_key === input.evidence_key)
    .first();
  if (!record || record.id === undefined) return false;

  // 破棄は取消不能。PHI を含めず識別子のみ監査ログに残す。
  console.warn('[phos-offline-evidence] discarded unrecoverable evidence', {
    packet_id: record.packet_id,
    card_id: record.card_id,
    evidence_key: record.evidence_key,
    offline_op_class: record.offline_op_class,
    retry_count: record.retry_count,
    last_error: record.last_error,
    created_at: record.created_at,
    discarded_at: new Date().toISOString(),
  });

  await phosOfflineEvidenceDb.pendingEvidence.delete(record.id);
  return true;
}
