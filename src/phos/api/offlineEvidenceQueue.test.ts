// @vitest-environment jsdom

import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  enqueuePhosOfflineEvidence,
  listPhosPendingEvidence,
  phosOfflineEvidenceDb,
  retryPhosOfflineEvidenceUploads,
} from './offlineEvidenceQueue';

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

  it('retries pending evidence through presign upload and removes synced records', async () => {
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
    const presignEvidenceUpload = vi.fn(async () => ({
      request_id: 'req_1',
      evidence_id: 'evidence_1',
      s3_key: 'tenants/tenant_abc123/evidence/card_1/evidence_1.jpg',
      upload_url: 'https://upload.example.com/evidence_1',
      method: 'PUT' as const,
      headers: { 'Content-Type': 'image/jpeg' },
      expires_in_seconds: 300,
      max_size_bytes: 25 * 1024 * 1024,
    }));
    const fetchImpl = vi.fn(async () => new Response(null, { status: 200 }));

    await expect(
      retryPhosOfflineEvidenceUploads({
        client: { presignEvidenceUpload },
        fetchImpl,
      }),
    ).resolves.toEqual({ synced: 1, failed: 0 });

    expect(presignEvidenceUpload).toHaveBeenCalledWith({
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
    expect(await phosOfflineEvidenceDb.pendingEvidence.count()).toBe(0);
  });
});
