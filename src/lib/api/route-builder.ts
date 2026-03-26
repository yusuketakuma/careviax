import { type ZodType } from 'zod';
import { type NextResponse } from 'next/server';
import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { validationError } from '@/lib/api/response';
import {
  validateOrgReferences,
  type OrgReferenceData,
  type OrgReferenceInput,
} from '@/lib/api/org-reference';
import { type PermissionKey } from '@/lib/auth/permissions';

type ReferenceSelectors<TBody> = {
  [K in keyof OrgReferenceInput]?: (body: TBody) => OrgReferenceInput[K];
};

type WithValidatedBodyOptions<TBody> = {
  permission: PermissionKey;
  message: string;
  bodySchema: ZodType<TBody>;
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
          resolver(parsed.data as TBody),
        ])
      ) as OrgReferenceInput;

      const referenceResult = await validateOrgReferences(req.orgId, resolvedReferences);
      if (!referenceResult.ok) return referenceResult.response;
      references = referenceResult.data;
    }

    return handler(req, {
      body: parsed.data as TBody,
      references,
    });
  }, {
    permission: options.permission,
    message: options.message,
  });
}
