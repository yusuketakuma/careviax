// @vitest-environment jsdom

import 'fake-indexeddb/auto';

import { Buffer } from 'node:buffer';
import { createHash, webcrypto } from 'node:crypto';
import { waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearOfflineEncryptionKey,
  encryptOfflinePayloadRequired,
  initOfflineEncryptionKey,
  isEncryptedOfflinePayload,
} from '@/lib/offline/crypto';
import { VisitStatus, VisitStep, type VisitModeView } from '@/phos/contracts/phos_contracts';
import {
  discardStuckPhosOfflineEvidence,
  enqueuePhosOfflineEvidence,
  listPhosPendingEvidence,
  MAX_OFFLINE_EVIDENCE_FILE_SIZE_BYTES,
  MAX_OFFLINE_EVIDENCE_QUEUE_BYTES,
  MAX_RETRIES,
  PHOS_OFFLINE_EVIDENCE_REPLAY_BATCH_SIZE,
  phosOfflineEvidenceDb,
  resetStuckPhosOfflineEvidence,
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
    patient_name: 'TEST_PATIENT_001',
    facility: 'TEST_FACILITY_001',
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

function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

function imageEvidence(bytes: Uint8Array | number[]): {
  bytes: Uint8Array;
  file: Blob;
  sha256: string;
} {
  const evidenceBytes = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return {
    bytes: evidenceBytes,
    file: new Blob([toArrayBuffer(evidenceBytes)], { type: 'image/jpeg' }),
    sha256: sha256Hex(evidenceBytes),
  };
}

async function addEncryptedEvidenceRecord(input: {
  file_bytes_base64: string;
  size_bytes: number;
  sha256: string;
}): Promise<void> {
  const payload = await encryptOfflinePayloadRequired(
    JSON.stringify({
      label: '復旧対象写真',
      evidence_type: 'PHOTO',
      file_name: 'recovery.jpg',
      mime_type: 'image/jpeg',
      sha256: input.sha256,
      file_bytes_base64: input.file_bytes_base64,
      size_bytes: input.size_bytes,
    }),
    'PH-OS offline evidence payload test fixture',
  );

  await phosOfflineEvidenceDb.pendingEvidence.add({
    card_id: 'card_1',
    packet_id: 'packet_1',
    evidence_key: 'middle_corrupt_photo',
    offline_op_class: 'BLOCKING',
    payload,
    size_bytes: input.size_bytes,
    created_at: '2026-06-10T00:00:00.000Z',
    retry_count: 0,
  });
}

async function expectUnreadableEvidenceReplay(): Promise<void> {
  const client = retryClient();
  const fetchImpl = vi.fn<typeof fetch>(async () => new Response(null, { status: 200 }));

  await expect(
    retryPhosOfflineEvidenceUploads({
      client,
      fetchImpl,
    }),
  ).resolves.toEqual({ synced: 0, failed: 1, verified_visits: [] });

  expect(client.presignEvidenceUpload).not.toHaveBeenCalled();
  expect(fetchImpl).not.toHaveBeenCalled();
  const records = await phosOfflineEvidenceDb.pendingEvidence.toArray();
  expect(records).toHaveLength(1);
  expect(records[0]).toMatchObject({
    evidence_key: 'middle_corrupt_photo',
    retry_count: 1,
    last_error: 'EVIDENCE_PAYLOAD_UNREADABLE',
  });
  await expect(listPhosPendingEvidence('packet_1')).resolves.toEqual([
    expect.objectContaining({
      evidence_key: 'middle_corrupt_photo',
      label: '未同期証跡（復旧が必要）',
      retry_count: 1,
      last_error: 'EVIDENCE_PAYLOAD_UNREADABLE',
    }),
  ]);
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

  it('keeps unreadable encrypted evidence visible and marks replay with a sanitized error', async () => {
    await phosOfflineEvidenceDb.pendingEvidence.add({
      card_id: 'card_1',
      packet_id: 'packet_1',
      evidence_key: 'corrupt_photo',
      offline_op_class: 'BLOCKING',
      payload: 'encv1:corrupt-ciphertext',
      size_bytes: 128,
      created_at: '2026-06-10T00:00:00.000Z',
      retry_count: 0,
    });
    await expect(listPhosPendingEvidence('packet_1')).resolves.toEqual([
      {
        evidence_key: 'corrupt_photo',
        label: '未同期証跡（復旧が必要）',
        offline_op_class: 'BLOCKING',
        created_at: '2026-06-10T00:00:00.000Z',
        retry_count: 0,
        last_error: 'EVIDENCE_PAYLOAD_UNREADABLE',
      },
    ]);
    const client = retryClient();
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(null, { status: 200 }));

    await expect(
      retryPhosOfflineEvidenceUploads({
        client,
        fetchImpl,
      }),
    ).resolves.toEqual({ synced: 0, failed: 1, verified_visits: [] });

    expect(client.presignEvidenceUpload).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
    const records = await phosOfflineEvidenceDb.pendingEvidence.toArray();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      evidence_key: 'corrupt_photo',
      retry_count: 1,
      last_error: 'EVIDENCE_PAYLOAD_UNREADABLE',
    });
    await expect(listPhosPendingEvidence('packet_1')).resolves.toEqual([
      expect.objectContaining({
        evidence_key: 'corrupt_photo',
        label: '未同期証跡（復旧が必要）',
        retry_count: 1,
        last_error: 'EVIDENCE_PAYLOAD_UNREADABLE',
      }),
    ]);
  });

  it('rejects JSON-valid encrypted evidence with invalid base64 before presign', async () => {
    await addEncryptedEvidenceRecord({
      file_bytes_base64: 'not-base64!',
      size_bytes: 3,
      sha256: sha256Hex(new Uint8Array([1, 2, 3])),
    });

    await expectUnreadableEvidenceReplay();
  });

  it('rejects JSON-valid encrypted evidence with mismatched decoded size before presign', async () => {
    const evidence = imageEvidence([1, 2, 3]);
    await addEncryptedEvidenceRecord({
      file_bytes_base64: Buffer.from(evidence.bytes).toString('base64'),
      size_bytes: evidence.bytes.byteLength + 1,
      sha256: evidence.sha256,
    });

    await expectUnreadableEvidenceReplay();
  });

  it('rejects JSON-valid encrypted evidence with mismatched sha256 before presign', async () => {
    const evidence = imageEvidence([1, 2, 3]);
    await addEncryptedEvidenceRecord({
      file_bytes_base64: Buffer.from(evidence.bytes).toString('base64'),
      size_bytes: evidence.bytes.byteLength,
      sha256: 'f'.repeat(64),
    });

    await expectUnreadableEvidenceReplay();
  });

  it('retries pending evidence through presign, S3 PUT, and server-side VisitMode verification', async () => {
    const evidence = imageEvidence([4, 5]);
    await enqueuePhosOfflineEvidence({
      card_id: 'card_1',
      packet_id: 'packet_1',
      evidence_key: 'optional_photo',
      label: '任意写真',
      evidence_type: 'PHOTO',
      file_name: 'optional.jpg',
      mime_type: 'image/jpeg',
      sha256: evidence.sha256,
      offline_op_class: 'NON_BLOCKING',
      file: evidence.file,
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
      sha256: evidence.sha256,
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
    expect([...new Uint8Array(await uploadBody.arrayBuffer())]).toEqual([...evidence.bytes]);
    expect(client.getVisitMode).toHaveBeenCalledWith('packet_1');
    expect(client.updateVisitStep).toHaveBeenCalledWith('packet_1', VisitStep.EVIDENCE_UPLOAD, {
      idempotency_key: 'evidence_verify_packet_1_optional_photo_evidence_1',
      client_version: 7,
      payload: { evidence_key: 'evidence_1' },
    });
    expect(await phosOfflineEvidenceDb.pendingEvidence.count()).toBe(0);
  });

  it('replays chunk-boundary evidence bytes byte-identically', async () => {
    const base64ChunkSize = 0x8000;
    const originalBytes = new Uint8Array(base64ChunkSize * 3 + 257);
    for (let index = 0; index < originalBytes.length; index += 1) {
      originalBytes[index] = (index * 31 + 17) & 0xff;
    }
    const evidence = imageEvidence(originalBytes);

    await enqueuePhosOfflineEvidence({
      card_id: 'card_1',
      packet_id: 'packet_1',
      evidence_key: 'large_chunked_photo',
      label: '大容量境界写真',
      evidence_type: 'PHOTO',
      file_name: 'large-chunked.jpg',
      mime_type: 'image/jpeg',
      sha256: evidence.sha256,
      offline_op_class: 'NON_BLOCKING',
      file: evidence.file,
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
    });

    const uploadBody = fetchImpl.mock.calls[0]?.[1]?.body as Blob;
    const uploadedBytes = new Uint8Array(await uploadBody.arrayBuffer());
    expect(uploadedBytes).toHaveLength(originalBytes.length);
    expect(uploadedBytes[0]).toBe(originalBytes[0]);
    expect(uploadedBytes[base64ChunkSize - 1]).toBe(originalBytes[base64ChunkSize - 1]);
    expect(uploadedBytes[base64ChunkSize]).toBe(originalBytes[base64ChunkSize]);
    expect(uploadedBytes[base64ChunkSize + 1]).toBe(originalBytes[base64ChunkSize + 1]);
    expect(uploadedBytes[base64ChunkSize * 2 - 1]).toBe(originalBytes[base64ChunkSize * 2 - 1]);
    expect(uploadedBytes[base64ChunkSize * 2]).toBe(originalBytes[base64ChunkSize * 2]);
    expect(Buffer.compare(Buffer.from(uploadedBytes), Buffer.from(originalBytes))).toBe(0);
    expect(await phosOfflineEvidenceDb.pendingEvidence.count()).toBe(0);
  });

  it('single-flights concurrent offline evidence upload replays against the shared queue', async () => {
    const evidence = imageEvidence([1, 2]);
    await enqueuePhosOfflineEvidence({
      card_id: 'card_1',
      packet_id: 'packet_1',
      evidence_key: 'singleflight_photo',
      label: '同時再送写真',
      evidence_type: 'PHOTO',
      file_name: 'singleflight.jpg',
      mime_type: 'image/jpeg',
      sha256: evidence.sha256,
      offline_op_class: 'NON_BLOCKING',
      file: evidence.file,
    });

    let resolveUpload!: (value: Response) => void;
    const client = retryClient();
    const fetchImpl = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveUpload = resolve;
        }),
    ) as unknown as typeof fetch;

    const first = retryPhosOfflineEvidenceUploads({ client, fetchImpl });
    const second = retryPhosOfflineEvidenceUploads({
      client: retryClient(),
      fetchImpl: vi.fn<typeof fetch>(async () => new Response(null, { status: 200 })),
    });

    await waitFor(() => {
      expect(client.presignEvidenceUpload).toHaveBeenCalledTimes(1);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    resolveUpload(new Response(null, { status: 200 }));
    await expect(Promise.all([first, second])).resolves.toEqual([
      {
        synced: 1,
        failed: 0,
        verified_visits: [expect.objectContaining({ packet_id: 'packet_1', server_version: 8 })],
      },
      {
        synced: 1,
        failed: 0,
        verified_visits: [expect.objectContaining({ packet_id: 'packet_1', server_version: 8 })],
      },
    ]);
    expect(await phosOfflineEvidenceDb.pendingEvidence.count()).toBe(0);
  });

  it('retries pending evidence across bounded IndexedDB batches', async () => {
    for (let index = 0; index < PHOS_OFFLINE_EVIDENCE_REPLAY_BATCH_SIZE + 2; index += 1) {
      const evidence = imageEvidence([index]);
      await enqueuePhosOfflineEvidence({
        card_id: `card_${index}`,
        packet_id: `packet_${index}`,
        evidence_key: `batch_photo_${index}`,
        label: `Batch photo ${index}`,
        evidence_type: 'PHOTO',
        file_name: `batch-${index}.jpg`,
        mime_type: 'image/jpeg',
        sha256: evidence.sha256,
        offline_op_class: 'NON_BLOCKING',
        file: evidence.file,
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
    const evidence = imageEvidence([9, 10]);
    await enqueuePhosOfflineEvidence({
      card_id: 'card_1',
      packet_id: 'packet_1',
      evidence_key: 'unsafe_photo',
      label: '危険URL写真',
      evidence_type: 'PHOTO',
      file_name: 'unsafe.jpg',
      mime_type: 'image/jpeg',
      sha256: evidence.sha256,
      offline_op_class: 'BLOCKING',
      file: evidence.file,
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
    const evidence = imageEvidence([11, 12]);
    await enqueuePhosOfflineEvidence({
      card_id: 'card_1',
      packet_id: 'packet_1',
      evidence_key: 'timeout_photo',
      label: 'タイムアウト写真',
      evidence_type: 'PHOTO',
      file_name: 'timeout.jpg',
      mime_type: 'image/jpeg',
      sha256: evidence.sha256,
      offline_op_class: 'BLOCKING',
      file: evidence.file,
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
    const evidence = imageEvidence([6, 7, 8]);
    await enqueuePhosOfflineEvidence({
      card_id: 'card_1',
      packet_id: 'packet_1',
      evidence_key: 'mandatory_photo',
      label: '必須写真',
      evidence_type: 'PHOTO',
      file_name: 'mandatory.jpg',
      mime_type: 'image/jpeg',
      sha256: evidence.sha256,
      offline_op_class: 'BLOCKING',
      file: evidence.file,
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

  async function enqueueStuckBlockingEvidence(overrides?: {
    packet_id?: string;
    card_id?: string;
    evidence_key?: string;
  }): Promise<{ id: number; sha256: string }> {
    const evidence = imageEvidence([13, 14, 15]);
    const { queue_id } = await enqueuePhosOfflineEvidence({
      card_id: overrides?.card_id ?? 'card_1',
      packet_id: overrides?.packet_id ?? 'packet_1',
      evidence_key: overrides?.evidence_key ?? 'stuck_photo',
      label: '必須写真',
      evidence_type: 'PHOTO',
      file_name: 'stuck.jpg',
      mime_type: 'image/jpeg',
      sha256: evidence.sha256,
      offline_op_class: 'BLOCKING',
      file: evidence.file,
    });
    const id = queue_id as number;
    // MAX_RETRIES に到達した「永続スキップ」状態を再現する
    await phosOfflineEvidenceDb.pendingEvidence.update(id, {
      retry_count: MAX_RETRIES,
      last_error: 'EVIDENCE_UPLOAD_RETRY_FAILED',
    });
    return { id, sha256: evidence.sha256 };
  }

  it('requeues retry-exhausted evidence so a maxed-out BLOCKING record stops blocking completion', async () => {
    const { id } = await enqueueStuckBlockingEvidence();
    const client = retryClient();
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(null, { status: 200 }));

    // stuck レコードは replay から永続スキップされ、BLOCKING として残り続ける
    await expect(retryPhosOfflineEvidenceUploads({ client, fetchImpl })).resolves.toEqual({
      synced: 0,
      failed: 0,
      verified_visits: [],
    });
    expect(client.presignEvidenceUpload).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(await listPhosPendingEvidence('packet_1')).toHaveLength(1);

    // 再試行導線: retry_count をリセットして再送対象へ戻す
    await expect(resetStuckPhosOfflineEvidence('packet_1')).resolves.toBe(1);
    const requeued = await phosOfflineEvidenceDb.pendingEvidence.get(id);
    expect(requeued?.retry_count).toBe(0);
    expect(requeued?.last_error).toBeUndefined();

    // リセット後の replay で同期され、BLOCKING がクリアされる → 完了ブロック解消
    await expect(retryPhosOfflineEvidenceUploads({ client, fetchImpl })).resolves.toMatchObject({
      synced: 1,
      failed: 0,
    });
    expect(await phosOfflineEvidenceDb.pendingEvidence.count()).toBe(0);
    expect(await listPhosPendingEvidence('packet_1')).toEqual([]);
  });

  it('scopes retry reset to the requested packet and leaves other packets stuck', async () => {
    await enqueueStuckBlockingEvidence({ packet_id: 'packet_1', evidence_key: 'stuck_a' });
    const other = await enqueueStuckBlockingEvidence({
      packet_id: 'packet_2',
      card_id: 'card_2',
      evidence_key: 'stuck_b',
    });

    await expect(resetStuckPhosOfflineEvidence('packet_1')).resolves.toBe(1);

    const otherRecord = await phosOfflineEvidenceDb.pendingEvidence.get(other.id);
    expect(otherRecord?.retry_count).toBe(MAX_RETRIES);
  });

  it('resets every stuck packet when no packet id is provided', async () => {
    await enqueueStuckBlockingEvidence({ packet_id: 'packet_1', evidence_key: 'stuck_a' });
    await enqueueStuckBlockingEvidence({
      packet_id: 'packet_2',
      card_id: 'card_2',
      evidence_key: 'stuck_b',
    });

    await expect(resetStuckPhosOfflineEvidence()).resolves.toBe(2);
    const stillStuck = await phosOfflineEvidenceDb.pendingEvidence
      .where('retry_count')
      .aboveOrEqual(MAX_RETRIES)
      .count();
    expect(stillStuck).toBe(0);
  });

  it('refuses to discard evidence without explicit acknowledgement', async () => {
    await enqueueStuckBlockingEvidence();

    await expect(
      discardStuckPhosOfflineEvidence({
        packet_id: 'packet_1',
        evidence_key: 'stuck_photo',
        acknowledged: false,
      }),
    ).rejects.toThrow('requires explicit acknowledgement');
    expect(await phosOfflineEvidenceDb.pendingEvidence.count()).toBe(1);
  });

  it('discards an unrecoverable evidence record only on explicit acknowledgement and audits it', async () => {
    await enqueueStuckBlockingEvidence();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(
      discardStuckPhosOfflineEvidence({
        packet_id: 'packet_1',
        evidence_key: 'stuck_photo',
        acknowledged: true,
      }),
    ).resolves.toBe(true);
    expect(await phosOfflineEvidenceDb.pendingEvidence.count()).toBe(0);
    expect(warn).toHaveBeenCalledWith(
      '[phos-offline-evidence] discarded unrecoverable evidence',
      expect.objectContaining({ packet_id: 'packet_1', evidence_key: 'stuck_photo' }),
    );

    // 対象が無い場合は破棄せず false を返す
    await expect(
      discardStuckPhosOfflineEvidence({
        packet_id: 'packet_1',
        evidence_key: 'missing_photo',
        acknowledged: true,
      }),
    ).resolves.toBe(false);
  });
});
