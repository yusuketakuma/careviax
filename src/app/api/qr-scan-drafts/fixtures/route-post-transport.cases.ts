import { expect, it, vi } from 'vitest';
import { getQrScanDraftRouteTestSupport } from './route.test-support';

const {
  withOrgContextMock,
  qrScanDraftFindFirstMock,
  qrScanDraftCreateMock,
  patientFindFirstMock,
  pharmacySiteFindFirstMock,
  jahisSupplementalRecordDeleteManyMock,
  jahisSupplementalRecordCreateManyMock,
  broadcastStatusUpdateMock,
  isJahisQRMock,
  parseJahisQRSafeMock,
  mapJahisToIntakeMock,
  POST,
  createRequest,
  createMalformedJsonRequest,
  createStreamRequest,
  createChunkedRequest,
  expectSensitiveNoStore,
} = getQrScanDraftRouteTestSupport();

export function registerQrScanDraftPostTransportCases() {
  it('rejects non-object JSON payloads before patient/site lookup or draft creation', async () => {
    const response = await POST(createRequest([]));

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'リクエストボディが不正です',
    });
    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(pharmacySiteFindFirstMock).not.toHaveBeenCalled();
    expect(isJahisQRMock).not.toHaveBeenCalled();
    expect(mapJahisToIntakeMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(qrScanDraftFindFirstMock).not.toHaveBeenCalled();
    expect(qrScanDraftCreateMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON payloads before patient/site lookup or draft creation', async () => {
    const response = await POST(createMalformedJsonRequest());

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'リクエストボディが不正です',
    });
    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(pharmacySiteFindFirstMock).not.toHaveBeenCalled();
    expect(isJahisQRMock).not.toHaveBeenCalled();
    expect(parseJahisQRSafeMock).not.toHaveBeenCalled();
    expect(mapJahisToIntakeMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(qrScanDraftFindFirstMock).not.toHaveBeenCalled();
    expect(qrScanDraftCreateMock).not.toHaveBeenCalled();
    expect(jahisSupplementalRecordCreateManyMock).not.toHaveBeenCalled();
    expect(broadcastStatusUpdateMock).not.toHaveBeenCalled();
  });

  it('rejects a chunked body over 512KiB despite a lying Content-Length before clinical work', async () => {
    const chunk = new Uint8Array(300 * 1024);
    const response = await POST(
      createChunkedRequest([chunk, chunk], {
        'content-length': '1',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(413);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toEqual({
      code: 'REQUEST_BODY_TOO_LARGE',
      message: 'リクエストボディが上限を超えています',
      details: { max_bytes: 512 * 1024 },
    });
    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(pharmacySiteFindFirstMock).not.toHaveBeenCalled();
    expect(isJahisQRMock).not.toHaveBeenCalled();
    expect(parseJahisQRSafeMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(qrScanDraftCreateMock).not.toHaveBeenCalled();
  });

  it('returns 408 before clinical work when QR body reading stalls', async () => {
    vi.useFakeTimers();
    let cancelled = false;
    const request = createStreamRequest(
      new ReadableStream<Uint8Array>({
        pull() {
          return new Promise(() => undefined);
        },
        cancel() {
          cancelled = true;
        },
      }),
    );

    const pending = POST(request);
    await vi.advanceTimersByTimeAsync(5_000);
    const response = await pending;

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(408);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toEqual({
      code: 'REQUEST_BODY_TIMEOUT',
      message: 'リクエストボディの受信がタイムアウトしました',
      details: { timeout_ms: 5_000 },
    });
    await Promise.resolve();
    expect(cancelled).toBe(true);
    expect(pharmacySiteFindFirstMock).not.toHaveBeenCalled();
    expect(isJahisQRMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
  });

  it('accepts the maximum valid multibyte QR array below the 512KiB transport budget', async () => {
    const qrTexts = Array.from(
      { length: 16 },
      (_, index) => `${'薬'.repeat(8190)}${String(index).padStart(2, '0')}`,
    );
    const body = JSON.stringify({ qr_texts: qrTexts, site_id: 'site_1' });
    expect(new TextEncoder().encode(body).byteLength).toBeLessThanOrEqual(512 * 1024);

    const response = await POST(createRequest({ qr_texts: qrTexts, site_id: 'site_1' }));

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    expect(isJahisQRMock).toHaveBeenCalledTimes(16);
    expect(qrScanDraftCreateMock).toHaveBeenCalledTimes(1);
  });

  it('persists enriched parsed_data from the QR mapper', async () => {
    const response = await POST(
      createRequest({
        qr_texts: [' JAHISTC08,1 '],
        patient_id: ' patient_1 ',
        site_id: ' site_1 ',
        session_id: ' session_1 ',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    expectSensitiveNoStore(response);
    expect(pharmacySiteFindFirstMock).toHaveBeenCalledWith({
      where: { id: 'site_1', org_id: 'org_1' },
      select: { id: true },
    });
    expect(isJahisQRMock).toHaveBeenCalledTimes(1);
    expect(isJahisQRMock).toHaveBeenCalledWith('JAHISTC08,1');
    expect(mapJahisToIntakeMock).toHaveBeenCalled();
    expect(qrScanDraftCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          site_id: 'site_1',
          patient_id: 'patient_1',
          session_id: 'session_1',
          raw_qr_texts: ['JAHISTC08,1'],
          qr_payload_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
          parsed_data: expect.objectContaining({
            patientName: '山田 太郎',
            prescriptionIssueDate: '2026-04-01',
            prescriptionExpirationDate: '2026-04-05',
            prescriptionInsurance: expect.objectContaining({
              insurerNumber: '06012345',
              publicSubsidies: [
                expect.objectContaining({ payerNumber: '54123456', recipientNumber: '7654321' }),
              ],
            }),
            rawRecords: [
              expect.objectContaining({ recordType: '21' }),
              expect.objectContaining({ recordType: '27' }),
            ],
            prescriberInstitutionId: 'inst_1',
            unmatchedDrugs: expect.any(Array),
            formularyStatus: [
              expect.objectContaining({
                drugName: 'アムロジピン錠5mg',
                inFormulary: false,
                warningLevel: 'warning',
                warningReason: 'stocked_generic_available',
              }),
            ],
            lines: [
              expect.objectContaining({
                drugName: 'アムロジピン錠5mg',
                drugCode: null,
                sourceDrugCode: 'RC_AMLO',
                sourceDrugCodeType: 'receipt',
                drugCodeResolutionStatus: 'review_required',
                drugCodeResolutionSource: 'drug_master_name_fallback',
                candidateDrugMasterId: 'drug_1',
                candidateDrugCode: '2149001',
                candidateDrugName: 'アムロジピン錠5mg',
                packagingInstructions: '一包化 / 別包',
                packagingInstructionTags: ['unit_dose', 'separate_pack'],
                dispensingMethod: 'unit_dose',
              }),
            ],
            supplementalRecords: [
              expect.objectContaining({
                recordType: '421',
                recordLabel: '残薬確認',
              }),
            ],
          }),
        }),
      }),
    );
    expect(qrScanDraftCreateMock.mock.calls[0]?.[0]?.data.parsed_data).not.toHaveProperty(
      'rawText',
    );
    expect(
      JSON.stringify(qrScanDraftCreateMock.mock.calls[0]?.[0]?.data.parsed_data),
    ).not.toContain('rawLine');
    expect(
      JSON.stringify(qrScanDraftCreateMock.mock.calls[0]?.[0]?.data.parsed_data),
    ).not.toContain('JAHISTC08');
    expect(jahisSupplementalRecordDeleteManyMock).toHaveBeenCalledWith({
      where: { org_id: 'org_1', qr_draft_id: 'draft_1' },
    });
    expect(jahisSupplementalRecordCreateManyMock).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          org_id: 'org_1',
          patient_id: 'patient_1',
          qr_draft_id: 'draft_1',
          prescription_intake_id: null,
          record_type: '421',
          record_label: '残薬確認',
          payload: expect.objectContaining({
            details: expect.arrayContaining([
              {
                label: '残薬内容',
                value: 'アムロジピンが10錠残薬。症状改善による自己判断で服用中断。',
              },
            ]),
          }),
        }),
      ],
    });
    expect(broadcastStatusUpdateMock).toHaveBeenCalledWith('org:org_1', {
      type: 'qr_draft_created',
    });
    const event = broadcastStatusUpdateMock.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(JSON.stringify(event)).not.toContain('draft_1');
    expect(JSON.stringify(event)).not.toContain('session_1');
    expect(JSON.stringify(event)).not.toContain('patient_1');
  });

  it('rejects QR texts duplicated in the same request instead of silently deduplicating them', async () => {
    const response = await POST(
      createRequest({
        qr_texts: [' JAHISTC08,1 ', 'JAHISTC08,1'],
        patient_id: 'patient_1',
        site_id: 'site_1',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '同じQRコードが重複しています',
      details: {
        qr_texts: ['同じQRコードを複数回読み取っています'],
      },
    });
    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(pharmacySiteFindFirstMock).not.toHaveBeenCalled();
    expect(isJahisQRMock).not.toHaveBeenCalled();
    expect(parseJahisQRSafeMock).not.toHaveBeenCalled();
    expect(qrScanDraftCreateMock).not.toHaveBeenCalled();
  });

  it('does not expose raw QR texts or payload hashes in the create response', async () => {
    qrScanDraftCreateMock.mockResolvedValueOnce({
      id: 'draft_1',
      status: 'pending',
      raw_qr_texts: ['JAHISTC08,1\n1,山田 太郎'],
      qr_payload_hash: 'a'.repeat(64),
      parsed_data: {
        patientName: '山田 太郎',
        rawText: 'JAHISTC08,1\n1,山田 太郎',
        rawRecords: [{ recordType: '1', lineNumber: 2 }],
      },
    });

    const response = await POST(
      createRequest({
        qr_texts: ['JAHISTC08,1'],
        patient_id: 'patient_1',
        site_id: 'site_1',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    expectSensitiveNoStore(response);
    const body = await response.json();
    expect(Object.keys(body)).toEqual(['data']);
    expect(body.data).toMatchObject({
      session_id: expect.any(String),
      parse_result: {
        success: true,
        warnings: [],
        errors: [],
      },
    });
    expect(body.data.draft).toMatchObject({
      id: 'draft_1',
      status: 'pending',
      parsed_data: {
        patientName: '山田 太郎',
        rawRecords: [{ recordType: '1', lineNumber: 2 }],
      },
    });
    expect(body).not.toHaveProperty('draft');
    expect(body).not.toHaveProperty('parse_result');
    expect(body).not.toHaveProperty('session_id');
    expect(body.data.draft).not.toHaveProperty('raw_qr_texts');
    expect(body.data.draft).not.toHaveProperty('qr_payload_hash');
    expect(body.data.draft.parsed_data).not.toHaveProperty('rawText');
    expect(JSON.stringify(body)).not.toContain('rawLine');
  });
}
