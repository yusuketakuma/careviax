'use client';

import Dexie, { type Table } from 'dexie';
import {
  VisitStep,
  type EvidencePendingView,
  type OfflineOpClass,
  type VisitModeView,
} from '@/phos/contracts/phos_contracts';
import type { PhosApiClient } from './types';

const MAX_RETRIES = 3;

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

export type PhosOfflineEvidenceRecord = Omit<PhosOfflineEvidenceInput, 'file'> & {
  id?: number;
  file_bytes: ArrayBuffer;
  size_bytes: number;
  created_at: string;
  retry_count: number;
  last_error?: string;
};

class PhosOfflineEvidenceDb extends Dexie {
  pendingEvidence!: Table<PhosOfflineEvidenceRecord, number>;

  constructor() {
    super('PH-OSEvidenceOfflineQueue');

    this.version(1).stores({
      pendingEvidence:
        '++id, card_id, packet_id, evidence_key, offline_op_class, created_at, retry_count',
    });
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

export async function enqueuePhosOfflineEvidence(
  input: PhosOfflineEvidenceInput,
): Promise<{ queue_id: number }> {
  assertBlobEvidence(input);
  const file_bytes = await input.file.arrayBuffer();
  const id = await phosOfflineEvidenceDb.pendingEvidence.add({
    card_id: input.card_id,
    packet_id: input.packet_id,
    evidence_key: input.evidence_key,
    label: input.label,
    evidence_type: input.evidence_type,
    file_name: input.file_name,
    mime_type: input.mime_type,
    sha256: input.sha256,
    offline_op_class: input.offline_op_class,
    file_bytes,
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
  return records.map((record) => ({
    evidence_key: record.evidence_key,
    label: record.label,
    offline_op_class: record.offline_op_class,
    created_at: record.created_at,
    retry_count: record.retry_count,
  }));
}

export async function retryPhosOfflineEvidenceUploads(input: {
  client: Pick<PhosApiClient, 'getVisitMode' | 'presignEvidenceUpload' | 'updateVisitStep'>;
  fetchImpl?: typeof fetch;
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
      const presigned = await input.client.presignEvidenceUpload({
        idempotency_key: `evidence_${record.packet_id}_${record.evidence_key}`,
        card_id: record.card_id,
        evidence_type: record.evidence_type,
        file_name: record.file_name,
        mime_type: record.mime_type,
        sha256: record.sha256,
        size_bytes: record.size_bytes,
      });
      const response = await fetchImpl(presigned.upload_url, {
        method: presigned.method,
        headers: presigned.headers,
        body: new Blob([record.file_bytes], { type: record.mime_type }),
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
          last_error: error instanceof Error ? error.message : 'Unknown evidence upload error',
        });
      }
    }
  }

  return { synced, failed, verified_visits: [...verifiedVisits.values()] };
}
