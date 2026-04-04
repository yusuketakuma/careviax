import { z } from 'zod';
import { withAuthContext, type AuthRouteContext } from '@/lib/auth/context';
import { notFound, success, validationError } from '@/lib/api/response';
import { updateDataExplorerRow } from '@/server/services/data-explorer';

const patchSchema = z.object({
  patch: z.record(z.string(), z.unknown()),
});

export const PATCH = withAuthContext<{ table: string; id: string }>(
  async (
    req,
    ctx,
    routeContext: AuthRouteContext<{ table: string; id: string }>
  ) => {
    const { table, id } = await routeContext.params;
    const body = await req.json().catch(() => null);
    if (!body) return validationError('リクエストボディが不正です');

    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    try {
      const data = await updateDataExplorerRow(ctx.orgId, table, id, parsed.data.patch);
      return success({ data });
    } catch (error) {
      if (error instanceof Error) {
        if (error.message.startsWith('Unknown table:')) {
          return validationError('対象テーブルが不正です');
        }
        if (error.message === 'No editable fields were provided') {
          return validationError('更新対象の編集可能フィールドがありません');
        }
        if (error.message === 'Row not found') {
          return notFound('対象レコードが見つかりません');
        }
      }
      return validationError('レコード更新に失敗しました');
    }
  },
  {
    permission: 'canAdmin',
    message: 'データ探索画面の利用権限がありません',
  }
);
