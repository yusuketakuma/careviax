import { z } from 'zod';
import { withAuthContext, type AuthRouteContext } from '@/lib/auth/context';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { forbidden, notFound, success, validationError } from '@/lib/api/response';
import {
  DATA_EXPLORER_DELETE_FORBIDDEN_ERROR,
  DATA_EXPLORER_READ_ONLY_MODEL_ERROR,
  deleteDataExplorerRow,
  updateDataExplorerRow,
} from '@/server/services/data-explorer';

const patchSchema = z.object({
  patch: z.record(z.string(), z.unknown()),
});

export const PATCH = withAuthContext<{ table: string; id: string }>(
  async (req, ctx, routeContext: AuthRouteContext<{ table: string; id: string }>) => {
    const { table, id } = await routeContext.params;
    const payload = await readJsonObjectRequestBody(req);
    if (!payload) return validationError('リクエストボディが不正です');

    const parsed = patchSchema.safeParse(payload);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    try {
      const data = await updateDataExplorerRow(ctx, table, id, parsed.data.patch);
      return success({ data });
    } catch (error) {
      if (error instanceof Error) {
        if (error.message.startsWith('Unknown table:')) {
          return validationError('対象テーブルが不正です');
        }
        if (error.message === DATA_EXPLORER_READ_ONLY_MODEL_ERROR) {
          return forbidden('このモデルは data-explorer から編集できません');
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
  },
);

export const DELETE = withAuthContext<{ table: string; id: string }>(
  async (_req, ctx, routeContext: AuthRouteContext<{ table: string; id: string }>) => {
    const { table, id } = await routeContext.params;

    try {
      const data = await deleteDataExplorerRow(ctx, table, id);
      return success({ data });
    } catch (error) {
      if (error instanceof Error) {
        if (error.message.startsWith('Unknown table:')) {
          return validationError('対象テーブルが不正です');
        }
        if (
          error.message === DATA_EXPLORER_READ_ONLY_MODEL_ERROR ||
          error.message === DATA_EXPLORER_DELETE_FORBIDDEN_ERROR
        ) {
          return forbidden('このモデルは data-explorer から削除できません');
        }
        if (error.message === 'Row not found') {
          return notFound('対象レコードが見つかりません');
        }
      }
      return validationError('レコード削除に失敗しました');
    }
  },
  {
    permission: 'canAdmin',
    message: 'データ探索画面の利用権限がありません',
  },
);
