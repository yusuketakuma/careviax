import { z } from 'zod';
import { apiDataSchema } from '@/lib/api/response-schemas';

type BuildQrScanDraftPayloadArgs = {
  qrTexts: string[];
  patientId: string;
  siteId: string | null | undefined;
  sessionId?: string | null;
};

export const qrScanDraftSessionIdResponseSchema = apiDataSchema(
  z
    .object({
      session_id: z.string().trim().min(1),
    })
    .passthrough(),
).transform(({ data }) => data.session_id);

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
