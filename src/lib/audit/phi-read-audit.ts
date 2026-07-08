import type { Prisma } from '@prisma/client';
import type { RequestAuthContext } from '@/lib/auth/request-context';
import { withOrgContext } from '@/lib/db/rls';
import { logger } from '@/lib/utils/logger';

/**
 * PHI 閲覧監査（3省2ガイドラインのアクセス記録要件）
 *
 * 患者単位の PHI を返す GET route が「誰が・どの組織で・どの患者を・どの画面から」
 * 閲覧したかを既存 AuditLog へ記録する共通ヘルパー。
 *
 * 方針:
 * - 記録内容は actor / org / patient_id / route(view) / purpose 相当のメタのみ。
 *   PHI 本文（氏名・住所・保険番号・臨床記載など）は一切記録しない。
 * - ベストエフォート非同期。監査書込みの失敗はレスポンスを妨げない（throw しない）。
 *   失敗時は logger.warn で観測可能にするだけに留める。
 * - 呼び出し側は fire-and-forget（await しない）で性能を落とさない。
 */

/** PHI 閲覧監査の action 名（AuditLog.action の命名規約に従う snake_case）。 */
export const PHI_READ_AUDIT_ACTION = 'phi_read';

type PhiReadAuditWriter = {
  auditLog: Pick<Prisma.TransactionClient['auditLog'], 'create'>;
};

type PhiReadAuditActor = {
  orgId: string;
  userId: string;
  actorPharmacyId?: string;
  actorSiteId?: string;
  ipAddress?: string;
  userAgent?: string;
};

type PhiReadAuditInput = {
  /** 閲覧対象の患者 ID。未紐づけ PHI detail では null/undefined を許可する。 */
  patientId?: string | null;
  /**
   * 閲覧された PHI 画面/エンドポイントの識別子（例: 'patient_detail'）。
   * changes.view に格納され、どの route 経由の閲覧かを後から追跡できるようにする。
   */
  view: string;
  /** AuditLog.target_type。既定は 'patient'。 */
  targetType?: string;
  /** AuditLog.target_id。既定は patientId。 */
  targetId?: string;
  /** 閲覧目的（例: 'care', 'billing'）。PHI 本文は含めないこと。 */
  purpose?: string;
  /** 追加メタ情報。PHI 本文は含めないこと（件数やフラグ等の非 PHI のみ）。 */
  metadata?: Record<string, unknown>;
};

/**
 * PHI 閲覧監査行を 1 件記録する（ベストエフォート）。
 *
 * 失敗しても throw せず logger.warn するのみ。呼び出し側は原則 fire-and-forget
 * （`void recordPhiReadAudit(...)`）で使用し、レスポンス性能を落とさない。
 */
export async function recordPhiReadAudit(
  db: PhiReadAuditWriter,
  actor: PhiReadAuditActor,
  input: PhiReadAuditInput,
): Promise<void> {
  try {
    const changes: Record<string, unknown> = { view: input.view };
    if (input.purpose) changes.purpose = input.purpose;
    if (input.metadata) changes.metadata = input.metadata;

    await db.auditLog.create({
      data: {
        org_id: actor.orgId,
        actor_id: actor.userId,
        actor_pharmacy_id: actor.actorPharmacyId ?? actor.orgId,
        actor_site_id: actor.actorSiteId,
        patient_id: input.patientId ?? undefined,
        action: PHI_READ_AUDIT_ACTION,
        target_type: input.targetType ?? 'patient',
        target_id: input.targetId ?? input.patientId ?? 'unknown',
        changes: changes as Prisma.InputJsonValue,
        ip_address: actor.ipAddress,
        user_agent: actor.userAgent,
      },
    });
  } catch (error) {
    // 監査書込みの失敗はレスポンスを妨げない。観測のため warn のみ。
    logger.warn(
      {
        event: 'phi_read_audit_write_failed',
        operation: 'record_phi_read_audit',
        orgId: actor.orgId,
        actorId: actor.userId,
        entityType: input.targetType ?? 'patient',
        entityId: input.targetId ?? input.patientId ?? 'unknown',
      },
      error,
    );
  }
}

/** リクエストコンテキスト（AuthContext 互換）から監査 actor を組み立てるための最小形状。 */
type PhiReadAuditRequestContext = {
  orgId: string;
  userId: string;
  role: RequestAuthContext['role'];
  actorPharmacyId?: string;
  actorSiteId?: string;
  ipAddress?: string;
  userAgent?: string;
};

/**
 * リクエストの AuthContext から PHI 閲覧監査を fire-and-forget で記録する。
 *
 * AuditLog は FORCE RLS（`WITH CHECK (org_id = current_setting('app.current_org_id'))`）
 * のため、書込みは必ず org コンテキストを張った短いトランザクション内で行う
 * （mutation route が `withOrgContext` 内で `createAuditLogEntry` を呼ぶのと同じ規約）。
 *
 * 本関数は void を返し、呼び出し側は `void recordPhiReadAuditForRequest(...)` として
 * await せずに使う。トランザクション確立や書込みの失敗はレスポンスを妨げず、warn のみ。
 */
export function recordPhiReadAuditForRequest(
  ctx: PhiReadAuditRequestContext,
  input: PhiReadAuditInput,
): void {
  const actor: PhiReadAuditActor = {
    orgId: ctx.orgId,
    userId: ctx.userId,
    ...(ctx.actorPharmacyId ? { actorPharmacyId: ctx.actorPharmacyId } : {}),
    ...(ctx.actorSiteId ? { actorSiteId: ctx.actorSiteId } : {}),
    ...(ctx.ipAddress ? { ipAddress: ctx.ipAddress } : {}),
    ...(ctx.userAgent ? { userAgent: ctx.userAgent } : {}),
  };
  const requestContext: RequestAuthContext = {
    userId: ctx.userId,
    orgId: ctx.orgId,
    role: ctx.role,
    ...(ctx.actorPharmacyId ? { actorPharmacyId: ctx.actorPharmacyId } : {}),
    ...(ctx.actorSiteId ? { actorSiteId: ctx.actorSiteId } : {}),
    ...(ctx.ipAddress ? { ipAddress: ctx.ipAddress } : {}),
    ...(ctx.userAgent ? { userAgent: ctx.userAgent } : {}),
  };

  const warnContextFailure = (error: unknown) => {
    // トランザクション確立自体の失敗（recordPhiReadAudit は内部で握り潰す）。
    logger.warn(
      {
        event: 'phi_read_audit_context_failed',
        operation: 'record_phi_read_audit_for_request',
        orgId: ctx.orgId,
        actorId: ctx.userId,
        entityType: input.targetType ?? 'patient',
        entityId: input.targetId ?? input.patientId ?? 'unknown',
      },
      error,
    );
  };

  // 監査は絶対にレスポンスを壊さない。非同期失敗（.catch）だけでなく、
  // 同期例外（例: 環境依存で withOrgContext が呼べない）も握り潰す。
  try {
    void withOrgContext(ctx.orgId, (tx) => recordPhiReadAudit(tx, actor, input), {
      requestContext,
    }).catch(warnContextFailure);
  } catch (error) {
    warnContextFailure(error);
  }
}
