import { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { withAuthContext } from '@/lib/auth/context';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { success, validationError } from '@/lib/api/response';
import { createAuditLogEntry } from '@/lib/audit/audit-entry';
import { prisma } from '@/lib/db/client';
import { withOrgContext } from '@/lib/db/rls';
import { hasPermission } from '@/lib/auth/permissions';
import { japanDateKey, japanMonthInstantRange } from '@/lib/utils/date-boundary';

/**
 * new_14_settings(薬局運用ポリシー)用 API。
 * 安全/働き方/通知の組織スコープ設定を Setting(scope=organization,
 * key=operational_policy)1 レコードの JSON として保持する。
 * 安全タグの表示・二人制監査・緊急(赤)通知は 3省2GL/安全要件のロック項目で、
 * サーバー側で常時 ON 固定(PATCH では受け付けない)。
 * docs/design-gap-analysis-new.md 14_settings。
 */

const OPERATIONAL_POLICY_SETTING_KEY = 'operational_policy';

/** 変更可能なポリシー項目(ロック項目はスキーマに含めない=サーバー固定) */
const policyValueSchema = z.object({
  /** 安全サインの感度(安全タグより下げることはできない) */
  safety_sign_sensitivity: z.enum(['low', 'standard', 'high']).default('standard'),
  /** 余白の計算(確定予定+移動時間からの自動計算) */
  slack_auto_calc: z.boolean().default(true),
  /** 割り込み防護(調剤・監査中は緊急以外で画面を切り替えない) */
  interrupt_guard: z.boolean().default(true),
  /** 待ち解除の通知 */
  wait_release_notification: z.boolean().default(true),
  /** 静かな時間(訪問モード中は緊急以外を後で表示) */
  quiet_hours: z.boolean().default(true),
});

export type OperationalPolicyValue = z.infer<typeof policyValueSchema>;

const updatePolicySchema = policyValueSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, { message: '更新する項目がありません' });

/** ロック項目(表示用メタ)。理由つきで常に明示する(隠さない)。 */
const LOCKED_ITEMS = [
  {
    key: 'safety_tag_display',
    label: '安全タグの表示',
    reason: '麻薬・冷所・アレルギー等のタグは全画面で常時表示(3省2GL安全要件)',
  },
  {
    key: 'two_person_audit',
    label: '二人制監査',
    reason: '調剤者と監査者の同一人チェックは無効化できません',
  },
  {
    key: 'emergency_notification',
    label: '緊急(赤)の通知',
    reason: '期限・安全に関わる通知は常にONです',
  },
] as const;

function parseStoredPolicy(value: Prisma.JsonValue | undefined): OperationalPolicyValue {
  const parsed = policyValueSchema.safeParse(value ?? {});
  return parsed.success ? parsed.data : policyValueSchema.parse({});
}

async function loadPolicyContext(orgId: string, userId: string) {
  // created_at(AuditLog, 実時刻)を JST 民間月で数える。setDate(1)+setHours のローカル月初だと
  // UTC prod で JST 月初/月末の変更が隣月にずれる。
  const monthStart = japanMonthInstantRange(japanDateKey().slice(0, 7)).gte;

  const [organization, membership, firstSite, settingRow, changeLogCount] = await Promise.all([
    prisma.organization.findFirst({ where: { id: orgId }, select: { name: true } }),
    prisma.membership.findFirst({
      where: { org_id: orgId, user_id: userId, is_active: true },
      select: { site: { select: { name: true } } },
    }),
    prisma.pharmacySite.findFirst({
      where: { org_id: orgId },
      orderBy: { created_at: 'asc' },
      select: { name: true },
    }),
    prisma.setting.findFirst({
      where: { scope: 'organization', scope_id: orgId, key: OPERATIONAL_POLICY_SETTING_KEY },
      select: { id: true, value: true },
    }),
    prisma.auditLog.count({
      where: {
        org_id: orgId,
        action: 'operational_policy_updated',
        created_at: { gte: monthStart },
      },
    }),
  ]);

  const siteName = membership?.site?.name ?? firstSite?.name ?? null;
  const pharmacyLabel = [organization?.name, siteName].filter(Boolean).join(' ') || '薬局未設定';

  return {
    pharmacyLabel,
    settingRow,
    policy: parseStoredPolicy(settingRow?.value),
    changeLogCount,
  };
}

function buildResponse(args: {
  pharmacyLabel: string;
  policy: OperationalPolicyValue;
  changeLogCount: number;
  canEdit: boolean;
}) {
  return {
    generated_at: new Date().toISOString(),
    pharmacy_label: args.pharmacyLabel,
    can_edit: args.canEdit,
    policy: args.policy,
    locked_items: LOCKED_ITEMS,
    /** WIP目安の改定メタ(目安マスタ未実装のため年度改定の固定表示) */
    wip_revision_label: '4/1改定',
    change_log_count_this_month: args.changeLogCount,
  };
}

export const GET = withAuthContext(
  async (_req, ctx) => {
    const context = await loadPolicyContext(ctx.orgId, ctx.userId);
    return success({
      data: buildResponse({
        pharmacyLabel: context.pharmacyLabel,
        policy: context.policy,
        changeLogCount: context.changeLogCount,
        canEdit: hasPermission(ctx.role, 'canAdmin'),
      }),
    });
  },
  {
    permission: 'canViewDashboard',
    message: '運用ポリシーの閲覧権限がありません',
  },
);

export const PATCH = withAuthContext(
  async (req: NextRequest, ctx) => {
    const payload = await readJsonObjectRequestBody(req);
    if (!payload) return validationError('リクエストボディが不正です');

    // ロック項目(安全タグ/二人制監査/緊急通知)は受け付けない
    const lockedKeys = ['safety_tag_display', 'two_person_audit', 'emergency_notification'];
    const requestedLockedKeys = Object.keys(payload).filter((key) => lockedKeys.includes(key));
    if (requestedLockedKeys.length > 0) {
      return validationError('安全項目はロックされているため変更できません', {
        keys: requestedLockedKeys,
      });
    }

    const parsed = updatePolicySchema.safeParse(payload);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    const context = await loadPolicyContext(ctx.orgId, ctx.userId);
    const nextPolicy: OperationalPolicyValue = { ...context.policy, ...parsed.data };

    await withOrgContext(ctx.orgId, async (tx) => {
      if (context.settingRow) {
        await tx.setting.update({
          where: { id: context.settingRow.id },
          data: { value: nextPolicy },
        });
      } else {
        await tx.setting.create({
          data: {
            scope: 'organization',
            scope_id: ctx.orgId,
            key: OPERATIONAL_POLICY_SETTING_KEY,
            value: nextPolicy,
          },
        });
      }

      await createAuditLogEntry(tx, ctx, {
        action: 'operational_policy_updated',
        targetType: 'Setting',
        targetId: OPERATIONAL_POLICY_SETTING_KEY,
        changes: {
          before: context.policy,
          after: nextPolicy,
          changed_keys: Object.keys(parsed.data),
        },
      });
    });

    return success({
      data: buildResponse({
        pharmacyLabel: context.pharmacyLabel,
        policy: nextPolicy,
        changeLogCount: context.changeLogCount + 1,
        canEdit: true,
      }),
    });
  },
  {
    permission: 'canAdmin',
    message: '運用ポリシーの更新権限がありません',
  },
);
