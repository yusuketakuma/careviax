// @vitest-environment jsdom

import 'fake-indexeddb/auto';

import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearOfflineEncryptionKey,
  initOfflineEncryptionKey,
  isEncryptedOfflinePayload,
} from '@/lib/offline/crypto';
import { VisitStatus, VisitStep, type VisitModeView } from '@/phos/contracts/phos_contracts';
import {
  enqueuePhosOfflineEvidence,
  listPhosPendingEvidence,
  MAX_OFFLINE_EVIDENCE_FILE_SIZE_BYTES,
  MAX_OFFLINE_EVIDENCE_QUEUE_BYTES,
  PHOS_OFFLINE_EVIDENCE_REPLAY_BATCH_SIZE,
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

function oversizedBlob(size: number): Blob & { arrayBuffer: ReturnType<typeof vi.fn> } {
  const blob = Object.create(Blob.prototype) as Blob & {
    arrayBuffer: ReturnType<typeof vi.fn>;
  };
  Object.defineProperties(blob, {
    size: { value: size },
    type: { value: 'image/jpeg' },
    arrayBuffer: { value: vi.fn(async () => new ArrayBuffer(0)) },
  });
  return blob;
}

describe('PH-OS offline evidence queue', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    Object.defineProperty(window, 'crypto', {
      configurable: true,
      value: webcrypto,
    });
    await indexedDB.deleteDatabase('ph-os-offline-keys');
    await indexedDB.deleteDatabase('PH-OSEvidenceOfflineQueue');
    await initOfflineEncryptionKey('user_1');
    await phosOfflineEvidenceDb.open();
  });

  afterEach(async () => {
    await clearOfflineEncryptionKey();
    phosOfflineEvidenceDb.close();
    await indexedDB.deleteDatabase('PH-OSEvidenceOfflineQueue');
    await indexedDB.deleteDatabase('ph-os-offline-keys');
  });

  it('stores photo evidence as encrypted payload and exposes pending badge view data', async () => {
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
    expect(records[0]).not.toHaveProperty('file_bytes');
    expect(records[0]).not.toHaveProperty('file_name');
    expect(records[0]).not.toHaveProperty('label');
    expect(records[0]).not.toHaveProperty('sha256');
    expect(isEncryptedOfflinePayload(records[0].payload)).toBe(true);
    expect(await listPhosPendingEvidence('packet_1')).toEqual([
      expect.objectContaining({
        evidence_key: 'mandatory_photo',
        label: '必須写真',
        offline_op_class: 'BLOCKING',
        retry_count: 0,
      }),
    ]);
  });

  it('fails closed when offline evidence encryption is unavailable', async () => {
    await clearOfflineEncryptionKey();

    await expect(
      enqueuePhosOfflineEvidence({
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
      }),
    ).rejects.toMatchObject({ name: 'OfflineEncryptionUnavailableError' });
    expect(await phosOfflineEvidenceDb.pendingEvidence.count()).toBe(0);
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

  it('rejects oversized evidence before reading file bytes into memory', async () => {
    const file = oversizedBlob(MAX_OFFLINE_EVIDENCE_FILE_SIZE_BYTES + 1);

    await expect(
      enqueuePhosOfflineEvidence({
        card_id: 'card_1',
        packet_id: 'packet_1',
        evidence_key: 'oversized_photo',
        label: '大容量写真',
        evidence_type: 'PHOTO',
        file_name: 'oversized.jpg',
        mime_type: 'image/jpeg',
        sha256: 'a'.repeat(64),
        offline_op_class: 'BLOCKING',
        file,
      }),
    ).rejects.toThrow('exceeds the offline size limit');
    expect(file.arrayBuffer).not.toHaveBeenCalled();
    expect(await phosOfflineEvidenceDb.pendingEvidence.count()).toBe(0);
  });

  it('rejects evidence that would exceed the offline queue quota before reading bytes', async () => {
    await phosOfflineEvidenceDb.pendingEvidence.add({
      card_id: 'card_existing',
      packet_id: 'packet_existing',
      evidence_key: 'existing_photo',
      offline_op_class: 'BLOCKING',
      payload: 'encv1:existing',
      size_bytes: MAX_OFFLINE_EVIDENCE_QUEUE_BYTES - 2,
      created_at: '2026-06-10T00:00:00.000Z',
      retry_count: 0,
    });
    const file = oversizedBlob(3);

    await expect(
      enqueuePhosOfflineEvidence({
        card_id: 'card_1',
        packet_id: 'packet_1',
        evidence_key: 'quota_photo',
        label: '容量超過写真',
        evidence_type: 'PHOTO',
        file_name: 'quota.jpg',
        mime_type: 'image/jpeg',
        sha256: 'a'.repeat(64),
        offline_op_class: 'BLOCKING',
        file,
      }),
    ).rejects.toThrow('exceeds the offline storage limit');
    expect(file.arrayBuffer).not.toHaveBeenCalled();
    expect(await phosOfflineEvidenceDb.pendingEvidence.count()).toBe(1);
  });

  it('purges legacy plaintext evidence records instead of exposing them', async () => {
    await phosOfflineEvidenceDb.pendingEvidence.add({
      card_id: 'card_1',
      packet_id: 'packet_1',
      evidence_key: 'legacy_photo',
      label: '平文写真',
      evidence_type: 'PHOTO',
      file_name: 'legacy.jpg',
      mime_type: 'image/jpeg',
      sha256: 'a'.repeat(64),
      offline_op_class: 'BLOCKING',
      file_bytes: new Uint8Array([1, 2, 3]).buffer,
      size_bytes: 3,
      created_at: '2026-06-10T00:00:00.000Z',
      retry_count: 0,
    } as never);

    await expect(listPhosPendingEvidence('packet_1')).resolves.toEqual([]);
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
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(null, { status: 200 }));

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
        credentials: 'omit',
        redirect: 'error',
        signal: expect.any(AbortSignal),
      }),
    );
    const uploadBody = fetchImpl.mock.calls[0]?.[1]?.body as Blob;
    expect([...new Uint8Array(await uploadBody.arrayBuffer())]).toEqual([4, 5]);
    expect(client.getVisitMode).toHaveBeenCalledWith('packet_1');
    expect(client.updateVisitStep).toHaveBeenCalledWith('packet_1', VisitStep.EVIDENCE_UPLOAD, {
      idempotency_key: 'evidence_verify_packet_1_optional_photo_evidence_1',
      client_version: 7,
      payload: { evidence_key: 'evidence_1' },
    });
    expect(await phosOfflineEvidenceDb.pendingEvidence.count()).toBe(0);
  });

  it('retries pending evidence across bounded IndexedDB batches', async () => {
    for (let index = 0; index < PHOS_OFFLINE_EVIDENCE_REPLAY_BATCH_SIZE + 2; index += 1) {
      await enqueuePhosOfflineEvidence({
        card_id: `card_${index}`,
        packet_id: `packet_${index}`,
        evidence_key: `batch_photo_${index}`,
        label: `Batch photo ${index}`,
        evidence_type: 'PHOTO',
        file_name: `batch-${index}.jpg`,
        mime_type: 'image/jpeg',
        sha256: 'f'.repeat(64),
        offline_op_class: 'NON_BLOCKING',
        file: new Blob([new Uint8Array([index])], { type: 'image/jpeg' }),
      });
    }
    const client = retryClient();
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(null, { status: 200 }));

    await expect(
      retryPhosOfflineEvidenceUploads({
        client,
        fetchImpl,
      }),
    ).resolves.toMatchObject({
      synced: PHOS_OFFLINE_EVIDENCE_REPLAY_BATCH_SIZE + 2,
      failed: 0,
    });

    expect(client.presignEvidenceUpload).toHaveBeenCalledTimes(
      PHOS_OFFLINE_EVIDENCE_REPLAY_BATCH_SIZE + 2,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(PHOS_OFFLINE_EVIDENCE_REPLAY_BATCH_SIZE + 2);
    expect(client.updateVisitStep).toHaveBeenCalledTimes(
      PHOS_OFFLINE_EVIDENCE_REPLAY_BATCH_SIZE + 2,
    );
    expect(await phosOfflineEvidenceDb.pendingEvidence.count()).toBe(0);
  });

  it('rejects unsafe presigned evidence upload URLs before sending bytes', async () => {
    await enqueuePhosOfflineEvidence({
      card_id: 'card_1',
      packet_id: 'packet_1',
      evidence_key: 'unsafe_photo',
      label: '危険URL写真',
      evidence_type: 'PHOTO',
      file_name: 'unsafe.jpg',
      mime_type: 'image/jpeg',
      sha256: 'd'.repeat(64),
      offline_op_class: 'BLOCKING',
      file: new Blob([new Uint8Array([9, 10])], { type: 'image/jpeg' }),
    });
    const client = retryClient({
      presignEvidenceUpload: vi.fn(async () => ({
        request_id: 'req_unsafe',
        evidence_id: 'evidence_unsafe',
        s3_key: 'tenants/tenant_abc123/evidence/card_1/evidence_unsafe.jpg',
        upload_url: 'https://user:pass@upload.example.com/evidence_unsafe?signature=secret',
        method: 'PUT' as const,
        headers: { 'Content-Type': 'image/jpeg' },
        expires_in_seconds: 300,
        max_size_bytes: 25 * 1024 * 1024,
      })),
    });
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(null, { status: 200 }));

    await expect(
      retryPhosOfflineEvidenceUploads({
        client,
        fetchImpl,
      }),
    ).resolves.toEqual({ synced: 0, failed: 1, verified_visits: [] });

    expect(fetchImpl).not.toHaveBeenCalled();
    const records = await phosOfflineEvidenceDb.pendingEvidence.toArray();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      evidence_key: 'unsafe_photo',
      retry_count: 1,
      last_error: 'EVIDENCE_UPLOAD_RETRY_FAILED',
    });
  });

  it('bounds stalled presigned evidence uploads with a timeout', async () => {
    await enqueuePhosOfflineEvidence({
      card_id: 'card_1',
      packet_id: 'packet_1',
      evidence_key: 'timeout_photo',
      label: 'タイムアウト写真',
      evidence_type: 'PHOTO',
      file_name: 'timeout.jpg',
      mime_type: 'image/jpeg',
      sha256: 'e'.repeat(64),
      offline_op_class: 'BLOCKING',
      file: new Blob([new Uint8Array([11, 12])], { type: 'image/jpeg' }),
    });

    let observedSignal: AbortSignal | undefined;
    const fetchImpl = vi.fn<typeof fetch>(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          observedSignal = init?.signal ?? undefined;
          observedSignal?.addEventListener(
            'abort',
            () => reject(new DOMException('Aborted', 'AbortError')),
            { once: true },
          );
        }),
    );

    await expect(
      retryPhosOfflineEvidenceUploads({
        client: retryClient(),
        fetchImpl,
        uploadTimeoutMs: 1,
      }),
    ).resolves.toEqual({ synced: 0, failed: 1, verified_visits: [] });

    expect(observedSignal?.aborted).toBe(true);
    const records = await phosOfflineEvidenceDb.pendingEvidence.toArray();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      evidence_key: 'timeout_photo',
      retry_count: 1,
      last_error: 'EVIDENCE_UPLOAD_RETRY_FAILED',
    });
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
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(null, { status: 200 }));

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
      last_error: 'EVIDENCE_UPLOAD_RETRY_FAILED',
    });
  });
});
