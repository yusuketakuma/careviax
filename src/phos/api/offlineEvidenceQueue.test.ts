// @vitest-environment jsdom

import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VisitStatus, VisitStep, type VisitModeView } from '@/phos/contracts/phos_contracts';
import {
  enqueuePhosOfflineEvidence,
  listPhosPendingEvidence,
  phosOfflineEvidenceDb,
  retryPhosOfflineEvidenceUploads,
} from './offlineEvidenceQueue';
import type { PhosApiClient } from './types';

const allIncomplete = Object.fromEntries(
  Object.values(VisitStep).map((step) => [step, false]),
) as Record<VisitStep, boolean>;

function visit(overrides: Partial<VisitModeView> = {}): VisitModeView {
  return {
    packet_id: 'packet_1',
    card_id: 'card_1',
    server_version: 7,
    patient_name: '患者 山田太郎',
    facility: '青空ホーム',
    room: '101',
    visit_status: VisitStatus.IN_PROGRESS,
    applicable_steps: [VisitStep.EVIDENCE_UPLOAD, VisitStep.COMPLETE_CHECK],
    required_steps: [VisitStep.EVIDENCE_UPLOAD, VisitStep.COMPLETE_CHECK],
    step_completed: allIncomplete,
    last_opened_step: VisitStep.EVIDENCE_UPLOAD,
    evidence_sync: { blocking_unsynced_count: 1, non_blocking_unsynced_count: 0 },
    online: true,
    ...overrides,
  };
}

function retryClient(
  overrides: Partial<
    Pick<PhosApiClient, 'getVisitMode' | 'presignEvidenceUpload' | 'updateVisitStep'>
  > = {},
): Pick<PhosApiClient, 'getVisitMode' | 'presignEvidenceUpload' | 'updateVisitStep'> {
  return {
    getVisitMode: vi.fn(async () => visit()),
    presignEvidenceUpload: vi.fn(async () => ({
      request_id: 'req_1',
      evidence_id: 'evidence_1',
      s3_key: 'tenants/tenant_abc123/evidence/card_1/evidence_1.jpg',
      upload_url: 'https://upload.example.com/evidence_1',
      method: 'PUT' as const,
      headers: { 'Content-Type': 'image/jpeg' },
      expires_in_seconds: 300,
      max_size_bytes: 25 * 1024 * 1024,
    })),
    updateVisitStep: vi.fn(async () =>
      visit({
        server_version: 8,
        step_completed: { ...allIncomplete, [VisitStep.EVIDENCE_UPLOAD]: true },
        evidence_sync: { blocking_unsynced_count: 0, non_blocking_unsynced_count: 0 },
      }),
    ),
    ...overrides,
  };
}

describe('PH-OS offline evidence queue', () => {
  beforeEach(async () => {
    await indexedDB.deleteDatabase('PH-OSEvidenceOfflineQueue');
    await phosOfflineEvidenceDb.open();
  });

  afterEach(async () => {
    phosOfflineEvidenceDb.close();
    await indexedDB.deleteDatabase('PH-OSEvidenceOfflineQueue');
  });

  it('stores photo evidence as Blob metadata and exposes pending badge view data', async () => {
    await enqueuePhosOfflineEvidence({
      card_id: 'card_1',
      packet_id: 'packet_1',
      evidence_key: 'mandatory_photo',
      label: '必須写真',
      evidence_type: 'PHOTO',
      file_name: 'mandatory.jpg',
      mime_type: 'image/jpeg',
      sha256: 'a'.repeat(64),
      offline_op_class: 'BLOCKING',
      file: new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' }),
    });

    const records = await phosOfflineEvidenceDb.pendingEvidence.toArray();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      card_id: 'card_1',
      packet_id: 'packet_1',
      evidence_key: 'mandatory_photo',
      offline_op_class: 'BLOCKING',
      size_bytes: 3,
      retry_count: 0,
    });
    expect(records[0].file_bytes.byteLength).toBe(3);
    expect(await listPhosPendingEvidence('packet_1')).toEqual([
      expect.objectContaining({
        evidence_key: 'mandatory_photo',
        label: '必須写真',
        offline_op_class: 'BLOCKING',
        retry_count: 0,
      }),
    ]);
  });

  it('rejects base64 or text payloads instead of storing them in IndexedDB', async () => {
    await expect(
      enqueuePhosOfflineEvidence({
        card_id: 'card_1',
        packet_id: 'packet_1',
        evidence_key: 'mandatory_photo',
        label: '必須写真',
        evidence_type: 'PHOTO',
        file_name: 'mandatory.txt',
        mime_type: 'text/plain',
        sha256: 'a'.repeat(64),
        offline_op_class: 'BLOCKING',
        file: new Blob(['data:image/jpeg;base64,AAAA'], { type: 'text/plain' }),
      }),
    ).rejects.toThrow('must not store base64 or text payloads');
    expect(await phosOfflineEvidenceDb.pendingEvidence.count()).toBe(0);
  });

  it('retries pending evidence through presign, S3 PUT, and server-side VisitMode verification', async () => {
    await enqueuePhosOfflineEvidence({
      card_id: 'card_1',
      packet_id: 'packet_1',
      evidence_key: 'optional_photo',
      label: '任意写真',
      evidence_type: 'PHOTO',
      file_name: 'optional.jpg',
      mime_type: 'image/jpeg',
      sha256: 'b'.repeat(64),
      offline_op_class: 'NON_BLOCKING',
      file: new Blob([new Uint8Array([4, 5])], { type: 'image/jpeg' }),
    });
    const client = retryClient();
    const fetchImpl = vi.fn(async () => new Response(null, { status: 200 }));

    await expect(
      retryPhosOfflineEvidenceUploads({
        client,
        fetchImpl,
      }),
    ).resolves.toMatchObject({
      synced: 1,
      failed: 0,
      verified_visits: [expect.objectContaining({ packet_id: 'packet_1', server_version: 8 })],
    });

    expect(client.presignEvidenceUpload).toHaveBeenCalledWith({
      idempotency_key: 'evidence_packet_1_optional_photo',
      card_id: 'card_1',
      evidence_type: 'PHOTO',
      file_name: 'optional.jpg',
      mime_type: 'image/jpeg',
      sha256: 'b'.repeat(64),
      size_bytes: 2,
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://upload.example.com/evidence_1',
      expect.objectContaining({
        method: 'PUT',
        headers: { 'Content-Type': 'image/jpeg' },
        body: expect.any(Blob),
      }),
    );
    expect(client.getVisitMode).toHaveBeenCalledWith('packet_1');
    expect(client.updateVisitStep).toHaveBeenCalledWith('packet_1', VisitStep.EVIDENCE_UPLOAD, {
      idempotency_key: 'evidence_verify_packet_1_optional_photo_evidence_1',
      client_version: 7,
      payload: { evidence_key: 'evidence_1' },
    });
    expect(await phosOfflineEvidenceDb.pendingEvidence.count()).toBe(0);
  });

  it('keeps uploaded evidence queued when server-side verification fails', async () => {
    await enqueuePhosOfflineEvidence({
      card_id: 'card_1',
      packet_id: 'packet_1',
      evidence_key: 'mandatory_photo',
      label: '必須写真',
      evidence_type: 'PHOTO',
      file_name: 'mandatory.jpg',
      mime_type: 'image/jpeg',
      sha256: 'c'.repeat(64),
      offline_op_class: 'BLOCKING',
      file: new Blob([new Uint8Array([6, 7, 8])], { type: 'image/jpeg' }),
    });
    const client = retryClient({
      updateVisitStep: vi.fn(async () => {
        throw new Error('server verification failed');
      }),
    });
    const fetchImpl = vi.fn(async () => new Response(null, { status: 200 }));

    await expect(
      retryPhosOfflineEvidenceUploads({
        client,
        fetchImpl,
      }),
    ).resolves.toEqual({ synced: 0, failed: 1, verified_visits: [] });

    expect(client.updateVisitStep).toHaveBeenCalledWith(
      'packet_1',
      VisitStep.EVIDENCE_UPLOAD,
      expect.objectContaining({
        payload: { evidence_key: 'evidence_1' },
      }),
    );
    const records = await phosOfflineEvidenceDb.pendingEvidence.toArray();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      evidence_key: 'mandatory_photo',
      retry_count: 1,
      last_error: 'server verification failed',
    });
  });
});
