import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { withOrgContext } from '@/lib/db/rls';
import { success, notFound, validationError, conflict } from '@/lib/api/response';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import {
  buildQrDraftAssignmentWhere,
  getAssignedPatientIds,
} from '@/server/services/prescription-access';
import { prisma } from '@/lib/db/client';

// ── GET: fetch single draft by id ──

export const GET = withAuth(
  async (req: AuthenticatedRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { id: rawId } = await params;
    const id = normalizeRequiredRouteParam(rawId);
    if (!id) return validationError('QRスキャン下書きIDが不正です');

    const assignedPatientIds = await getAssignedPatientIds(prisma, req.orgId, req);
    const assignmentWhere = buildQrDraftAssignmentWhere(req, assignedPatientIds ?? []);

    const draft = await withOrgContext(req.orgId, async (tx) => {
      return tx.qrScanDraft.findFirst({
        where: {
          id,
          org_id: req.orgId,
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
              payload: true,
              raw_line: true,
            },
          },
        },
      });
    });

    if (!draft) {
      return notFound('QRスキャン下書きが見つかりません');
    }

    return success(draft);
  },
  {
    permission: 'canVisit',
    message: 'QRスキャン下書きの閲覧権限がありません',
  },
);

// ── DELETE: discard a draft (set status to 'discarded') ──

export const DELETE = withAuth(
  async (req: AuthenticatedRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { id: rawId } = await params;
    const id = normalizeRequiredRouteParam(rawId);
    if (!id) return validationError('QRスキャン下書きIDが不正です');

    const assignedPatientIds = await getAssignedPatientIds(prisma, req.orgId, req);
    const assignmentWhere = buildQrDraftAssignmentWhere(req, assignedPatientIds ?? []);

    const existing = await withOrgContext(req.orgId, async (tx) => {
      return tx.qrScanDraft.findFirst({
        where: {
          id,
          org_id: req.orgId,
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

    const draft = await withOrgContext(req.orgId, async (tx) => {
      const discardResult = await tx.qrScanDraft.updateMany({
        where: {
          id,
          org_id: req.orgId,
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
        data: { status: 'discarded' },
      });

      await tx.jahisSupplementalRecord.deleteMany({
        where: {
          org_id: req.orgId,
          qr_draft_id: id,
          prescription_intake_id: null,
        },
      });

      return updated;
    });

    if (!draft) {
      return conflict('このQRスキャン下書きはすでに処理済みです');
    }

    return success(draft);
  },
  {
    permission: 'canVisit',
    message: 'QRスキャン下書きの操作権限がありません',
  },
);
