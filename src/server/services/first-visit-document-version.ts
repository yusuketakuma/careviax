import type { Prisma } from '@prisma/client';

export const FIRST_VISIT_DOCUMENT_VERSION_CONFLICT_MESSAGE =
  '初回文書が他のユーザーによって更新されています。最新のデータを取得してください。';
export const FIRST_VISIT_DOCUMENT_VERSION_CONFLICT_REASON = 'first_visit_document_version_conflict';

export class FirstVisitDocumentVersionConflictError extends Error {
  constructor(message = FIRST_VISIT_DOCUMENT_VERSION_CONFLICT_MESSAGE) {
    super(message);
    this.name = 'FirstVisitDocumentVersionConflictError';
  }
}

type FirstVisitDocumentVersionClient = Pick<Prisma.TransactionClient, 'firstVisitDocument'>;

export function nextFirstVisitDocumentVersion(expectedUpdatedAt: Date, now = new Date()) {
  return new Date(Math.max(now.getTime(), expectedUpdatedAt.getTime() + 1));
}

export async function claimFirstVisitDocumentVersion(
  db: FirstVisitDocumentVersionClient,
  args: {
    id: string;
    orgId: string;
    expectedUpdatedAt: Date;
    data?: Prisma.FirstVisitDocumentUpdateManyMutationInput;
    now?: Date;
  },
) {
  const updatedAt = nextFirstVisitDocumentVersion(args.expectedUpdatedAt, args.now);
  const result = await db.firstVisitDocument.updateMany({
    where: {
      id: args.id,
      org_id: args.orgId,
      updated_at: args.expectedUpdatedAt,
    },
    data: {
      ...args.data,
      updated_at: updatedAt,
    },
  });

  if (result.count !== 1) {
    throw new FirstVisitDocumentVersionConflictError();
  }

  return updatedAt;
}
