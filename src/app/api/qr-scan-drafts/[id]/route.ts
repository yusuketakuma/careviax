import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { withOrgContext } from '@/lib/db/rls';
import { success, notFound } from '@/lib/api/response';

// ── GET: fetch single draft by id ──

export const GET = withAuth(
  async (req: AuthenticatedRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;

    const draft = await withOrgContext(req.orgId, async (tx) => {
      return tx.qrScanDraft.findFirst({
        where: { id, org_id: req.orgId },
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
  }
);

// ── DELETE: discard a draft (set status to 'discarded') ──

export const DELETE = withAuth(
  async (req: AuthenticatedRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;

    const existing = await withOrgContext(req.orgId, async (tx) => {
      return tx.qrScanDraft.findFirst({
        where: { id, org_id: req.orgId },
        select: { id: true, status: true },
      });
    });

    if (!existing) {
      return notFound('QRスキャン下書きが見つかりません');
    }

    const draft = await withOrgContext(req.orgId, async (tx) => {
      return tx.qrScanDraft.update({
        where: { id },
        data: { status: 'discarded' },
      });
    });

    return success(draft);
  },
  {
    permission: 'canVisit',
    message: 'QRスキャン下書きの操作権限がありません',
  }
);
