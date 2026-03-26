import { type ZodType, type ZodTypeDef } from 'zod';
import { type NextResponse, NextResponse as NR } from 'next/server';
import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { validationError } from '@/lib/api/response';
import {
  validateOrgReferences,
  type OrgReferenceData,
  type OrgReferenceInput,
} from '@/lib/api/org-reference';
import { type PermissionKey, hasPermission } from '@/lib/auth/permissions';
import { prisma } from '@/lib/db/client';

type ReferenceSelectors<TBody> = {
  [K in keyof OrgReferenceInput]?: (body: TBody) => OrgReferenceInput[K];
};

type WithValidatedBodyOptions<TBody> = {
  permission: PermissionKey;
  message: string;
  bodySchema: ZodType<TBody, ZodTypeDef, unknown>;
  references?: ReferenceSelectors<TBody>;
};

type RouteContext<TBody> = {
  body: TBody;
  references: OrgReferenceData;
};

const EMPTY_REFERENCES: OrgReferenceData = {
  patient: null,
  careCase: null,
  visitRecord: null,
  issue: null,
  cycle: null,
  plan: null,
  task: null,
  site: null,
  pharmacistMembership: null,
  schedule: null,
};

export function withValidatedBody<TBody>(
  options: WithValidatedBodyOptions<TBody>,
  handler: (
    req: AuthenticatedRequest,
    context: RouteContext<TBody>
  ) => Promise<NextResponse>
) {
  return withAuth(async (req: AuthenticatedRequest) => {
    // Permission check via membership role
    if (options.permission) {
      const membership = await prisma.membership.findFirst({
        where: { user_id: req.userId, org_id: req.orgId, is_active: true },
        select: { role: true },
      });
      if (!membership || !hasPermission(membership.role, options.permission)) {
        return NR.json(
          { code: 'AUTH_FORBIDDEN', message: options.message ?? '権限がありません' },
          { status: 403 }
        );
      }
    }

    const body = await req.json().catch(() => null);
    if (!body) return validationError('リクエストボディが不正です');

    const parsed = options.bodySchema.safeParse(body);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    let references = EMPTY_REFERENCES;
    if (options.references) {
      const resolvedReferences = Object.fromEntries(
        Object.entries(options.references).map(([key, resolver]) => [
          key,
          resolver(parsed.data),
        ])
      ) as OrgReferenceInput;

      const referenceResult = await validateOrgReferences(req.orgId, resolvedReferences);
      if (!referenceResult.ok) return referenceResult.response;
      references = referenceResult.data;
    }

    return handler(req, {
      body: parsed.data,
      references,
    });
  });
}
