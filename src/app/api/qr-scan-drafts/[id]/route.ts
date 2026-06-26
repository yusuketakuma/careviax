import { NextRequest } from 'next/server';
import { withAuthContext } from '@/lib/auth/context';
import { withOrgContext } from '@/lib/db/rls';
import { success, notFound, validationError, conflict, internalError } from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import {
  buildQrDraftAssignmentWhere,
  getAssignedPatientIds,
} from '@/server/services/prescription-access';
import { prisma } from '@/lib/db/client';
import { Prisma } from '@prisma/client';

type QrDraftResponse = {
  raw_qr_texts?: unknown;
  qr_payload_hash?: unknown;
  parsed_data?: unknown;
  [key: string]: unknown;
};

function sanitizeParsedDataForResponse(parsedData: unknown): unknown {
  if (Array.isArray(parsedData)) return parsedData.map(sanitizeParsedDataForResponse);
  if (!parsedData || typeof parsedData !== 'object') return parsedData;

  return Object.fromEntries(
    Object.entries(parsedData as Record<string, unknown>)
      .filter(([key]) => !['rawText', 'rawLine', 'raw_qr_texts', 'qr_payload_hash'].includes(key))
      .map(([key, value]) => [key, sanitizeParsedDataForResponse(value)]),
  );
}

function toQrDraftResponse<T extends QrDraftResponse>(draft: T) {
  const sanitized = { ...draft };
  delete sanitized.raw_qr_texts;
  delete sanitized.qr_payload_hash;
  return {
    ...sanitized,
    parsed_data: sanitizeParsedDataForResponse(draft.parsed_data),
  };
}

// ── GET: fetch single draft by id ──

const authenticatedGET = withAuthContext(
  async (_req, ctx, { params }) => {
    const { id: rawId } = await params;
    const id = normalizeRequiredRouteParam(rawId);
    if (!id) return validationError('QRスキャン下書きIDが不正です');

    const assignedPatientIds = await getAssignedPatientIds(prisma, ctx.orgId, ctx);
    const assignmentWhere = buildQrDraftAssignmentWhere(ctx, assignedPatientIds ?? []);

    const draft = await withOrgContext(ctx.orgId, async (tx) => {
      return tx.qrScanDraft.findFirst({
        where: {
          id,
          org_id: ctx.orgId,
          ...(assignmentWhere ? { AND: [assignmentWhere] } : {}),
        },
        include: {
          jahis_supplemental_records: {
            orderBy: [{ line_number: 'asc' }, { created_at: 'asc' }],
            select: {
              id: true,
              record_type: true,
              record_label: true,
              line_number: true,
              summary: true,
            },
          },
        },
      });
    });

    if (!draft) {
      return notFound('QRスキャン下書きが見つかりません');
    }

    return success(toQrDraftResponse(draft));
  },
  {
    permission: 'canVisit',
    message: 'QRスキャン下書きの閲覧権限がありません',
  },
);

export async function GET(req: NextRequest, routeContext: { params: Promise<{ id: string }> }) {
  try {
    return withSensitiveNoStore(await authenticatedGET(req, routeContext));
  } catch {
    return withSensitiveNoStore(internalError());
  }
}

// ── DELETE: discard a draft (set status to 'discarded') ──

const authenticatedDELETE = withAuthContext(
  async (_req, ctx, { params }) => {
    const { id: rawId } = await params;
    const id = normalizeRequiredRouteParam(rawId);
    if (!id) return validationError('QRスキャン下書きIDが不正です');

    const assignedPatientIds = await getAssignedPatientIds(prisma, ctx.orgId, ctx);
    const assignmentWhere = buildQrDraftAssignmentWhere(ctx, assignedPatientIds ?? []);

    const existing = await withOrgContext(ctx.orgId, async (tx) => {
      return tx.qrScanDraft.findFirst({
        where: {
          id,
          org_id: ctx.orgId,
          ...(assignmentWhere ? { AND: [assignmentWhere] } : {}),
        },
        select: { id: true, status: true },
      });
    });

    if (!existing) {
      return notFound('QRスキャン下書きが見つかりません');
    }
    if (existing.status !== 'pending') {
      return validationError('このQRスキャン下書きはすでに処理済みです');
    }

    const draft = await withOrgContext(ctx.orgId, async (tx) => {
      const discardResult = await tx.qrScanDraft.updateMany({
        where: {
          id,
          org_id: ctx.orgId,
          status: 'pending',
          ...(assignmentWhere ? { AND: [assignmentWhere] } : {}),
        },
        data: { status: 'discarded' },
      });

      if (discardResult.count === 0) {
        return null;
      }

      const updated = await tx.qrScanDraft.update({
        where: { id },
        data: {
          status: 'discarded',
          raw_qr_texts: [],
          qr_payload_hash: null,
          parsed_data: {
            discarded: true,
            discarded_at: new Date().toISOString(),
          },
          parse_errors: Prisma.JsonNull,
          auto_completed: Prisma.JsonNull,
          expected_qr_count: null,
        },
      });

      await tx.jahisSupplementalRecord.deleteMany({
        where: {
          org_id: ctx.orgId,
          qr_draft_id: id,
          prescription_intake_id: null,
        },
      });

      return updated;
    });

    if (!draft) {
      return conflict('このQRスキャン下書きはすでに処理済みです');
    }

    return success(toQrDraftResponse(draft));
  },
  {
    permission: 'canVisit',
    message: 'QRスキャン下書きの操作権限がありません',
  },
);

export async function DELETE(req: NextRequest, routeContext: { params: Promise<{ id: string }> }) {
  try {
    return withSensitiveNoStore(await authenticatedDELETE(req, routeContext));
  } catch {
    return withSensitiveNoStore(internalError());
  }
}
