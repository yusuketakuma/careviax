'use client';

import Dexie, { type Table } from 'dexie';
import { decryptOfflinePayload, encryptOfflinePayloadRequired } from '@/lib/offline/crypto';
import { normalizePositiveTimeoutMs } from '@/lib/utils/timeout';
import {
  VisitStep,
  type EvidencePendingView,
  type OfflineOpClass,
  type VisitModeView,
} from '@/phos/contracts/phos_contracts';
import type { PhosApiClient } from './types';

const MAX_RETRIES = 3;
const BASE64_CHUNK_SIZE = 0x8000;
const DEFAULT_EVIDENCE_UPLOAD_TIMEOUT_MS = 30_000;
const MAX_EVIDENCE_UPLOAD_TIMEOUT_MS = 120_000;

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

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunks: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += BASE64_CHUNK_SIZE) {
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + BASE64_CHUNK_SIZE)));
  }
  return btoa(chunks.join(''));
}

function base64ToArrayBuffer(value: string): ArrayBuffer {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
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
): Promise<EncryptedEvidencePayload | null> {
  if (await deleteLegacyPlaintextRecord(record)) return null;
  const decrypted = await decryptOfflinePayload(record.payload);
  if (!decrypted) return null;
  try {
    const parsed = JSON.parse(decrypted) as unknown;
    return isEncryptedEvidencePayload(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function safeRetryError(error: unknown): string {
  if (error instanceof Error && /^Evidence upload failed with HTTP \d{3}$/.test(error.message)) {
    return error.message;
  }
  return 'EVIDENCE_UPLOAD_RETRY_FAILED';
}

function maybeUnrefTimeout(timeout: ReturnType<typeof setTimeout>): void {
  if (typeof timeout === 'object' && timeout && 'unref' in timeout) {
    (timeout as { unref?: () => void }).unref?.();
  }
}

function createUploadAbort(
  timeoutMs: number,
  callerSignal?: AbortSignal,
): {
  signal: AbortSignal;
  didTimeout: () => boolean;
  clear: () => void;
} {
  const controller = new AbortController();
  let timedOut = false;
  const abortFromCaller = () => controller.abort(callerSignal?.reason);

  if (callerSignal?.aborted) {
    abortFromCaller();
  } else {
    callerSignal?.addEventListener('abort', abortFromCaller, { once: true });
  }

  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort(new Error('PHOS_EVIDENCE_UPLOAD_TIMEOUT'));
  }, timeoutMs);
  maybeUnrefTimeout(timeout);

  return {
    signal: controller.signal,
    didTimeout: () => timedOut,
    clear: () => {
      clearTimeout(timeout);
      callerSignal?.removeEventListener('abort', abortFromCaller);
    },
  };
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
  const uploadAbort = createUploadAbort(effectiveTimeoutMs, input.signal);
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
    const payload = await readQueuedEvidencePayload(record);
    if (!payload) continue;
    views.push({
      evidence_key: record.evidence_key,
      label: payload.label,
      offline_op_class: record.offline_op_class,
      created_at: record.created_at,
      retry_count: record.retry_count,
    });
  }
  return views;
}

export async function retryPhosOfflineEvidenceUploads(input: {
  client: Pick<PhosApiClient, 'getVisitMode' | 'presignEvidenceUpload' | 'updateVisitStep'>;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  uploadTimeoutMs?: number;
}): Promise<{ synced: number; failed: number; verified_visits: VisitModeView[] }> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const pending = await phosOfflineEvidenceDb.pendingEvidence
    .where('retry_count')
    .below(MAX_RETRIES)
    .toArray();
  let synced = 0;
  let failed = 0;
  const verifiedVisits = new Map<string, VisitModeView>();

  for (const record of pending) {
    try {
      const payload = await readQueuedEvidencePayload(record);
      if (!payload) continue;
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
        body: new Blob([base64ToArrayBuffer(payload.file_bytes_base64)], {
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
      if (record.id !== undefined) await phosOfflineEvidenceDb.pendingEvidence.delete(record.id);
      synced++;
    } catch (error) {
      failed++;
      if (record.id !== undefined) {
        await phosOfflineEvidenceDb.pendingEvidence.update(record.id, {
          retry_count: record.retry_count + 1,
          last_error: safeRetryError(error),
        });
      }
    }
  }

  return { synced, failed, verified_visits: [...verifiedVisits.values()] };
}
