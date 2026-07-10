type BuildQrScanDraftPayloadArgs = {
  qrTexts: string[];
  patientId: string;
  siteId: string | null | undefined;
  sessionId?: string | null;
};

const QR_DRAFT_CREATE_ERROR = 'PCへの送信に失敗しました';

export function buildQrScanDraftPayload({
  qrTexts,
  patientId,
  siteId,
  sessionId,
}: BuildQrScanDraftPayloadArgs) {
  const normalizedSiteId = siteId?.trim();
  if (!normalizedSiteId) {
    throw new Error('店舗が未設定です。ログインユーザーの所属店舗を確認してください');
  }

  return {
    qr_texts: qrTexts,
    patient_id: patientId,
    site_id: normalizedSiteId,
    ...(sessionId ? { session_id: sessionId } : {}),
  };
}

export function extractQrScanDraftSessionId(payload: unknown): string {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error(QR_DRAFT_CREATE_ERROR);
  }

  const data = (payload as { data?: unknown }).data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error(QR_DRAFT_CREATE_ERROR);
  }

  const sessionId = (data as { session_id?: unknown }).session_id;
  if (typeof sessionId !== 'string' || !sessionId.trim()) {
    throw new Error(QR_DRAFT_CREATE_ERROR);
  }

  return sessionId;
}
