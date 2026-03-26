import { NextRequest } from 'next/server';
import { withAuthContext } from '@/lib/auth/context';
import { success, notFound } from '@/lib/api/response';
import { prisma } from '@/lib/db/client';

export const GET = withAuthContext(
  async (
    _req: NextRequest,
    _ctx,
    { params }: { params: Promise<{ id: string }> }
  ) => {
    const { id } = await params;

    const drug = await prisma.drugMaster.findUnique({
      where: { id },
      include: {
        package_inserts: {
          orderBy: { revised_at: 'desc' },
          take: 1,
          select: {
            id: true,
            contraindications: true,
            interactions: true,
            adverse_effects: true,
            dosage_adjustment_renal: true,
            precautions_elderly: true,
            document_version: true,
            revised_at: true,
          },
        },
        interactions_as_a: {
          take: 20,
          include: {
            drug_b: { select: { id: true, drug_name: true, yj_code: true } },
          },
        },
        interactions_as_b: {
          take: 20,
          include: {
            drug_a: { select: { id: true, drug_name: true, yj_code: true } },
          },
        },
      },
    });

    if (!drug) return notFound('医薬品が見つかりません');

    return success(drug);
  }
);
