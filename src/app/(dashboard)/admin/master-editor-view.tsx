'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { StateBadge } from '@/components/ui/state-badge';
import { PageScaffold } from '@/components/layout/page-scaffold';
import { AdminPageHeader } from '@/components/features/admin/admin-page-header';

const MASTER_CATEGORIES = ['薬剤', '医療機関', '施設', 'スタッフ', '車両', 'タグ', '帳票'] as const;
const MASTER_FIELDS = ['名称', 'コード', '分類', '注意ポイント', '表示するタグ', 'メモ'] as const;

type MasterEditorCategory = (typeof MASTER_CATEGORIES)[number];

type MasterEditorViewProps = {
  activeCategory: MasterEditorCategory;
  listTitle: string;
  itemPrefix: string;
  testId: string;
};

export function MasterEditorView({
  activeCategory,
  listTitle,
  itemPrefix,
  testId,
}: MasterEditorViewProps) {
  const masters = Array.from({ length: 8 }, (_, index) => `${itemPrefix} ${index + 1}`);

  return (
    <PageScaffold>
      {/* SYS-2: 共通 AdminPageHeader を付与し h1 とページ構成を他 admin 画面に揃える。
          ADD-9: 実データ未接続のサンプル表示である旨を supportingContent で明示する。 */}
      <AdminPageHeader
        title={listTitle}
        description={`${activeCategory}マスタの登録・編集を行います。`}
        supportingContent={
          <div className="space-y-1">
            <h2 className="text-base font-semibold text-foreground">サンプル表示</h2>
            <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
              実データ接続待ちのマスターです。固定サンプルで項目構成を確認でき、登録・編集操作は保存されません。
            </p>
          </div>
        }
      />
      <div
        className="grid min-h-[calc(100dvh-16rem)] gap-5 lg:grid-cols-[220px_340px_minmax(0,1fr)] lg:gap-7 xl:grid-cols-[280px_430px_minmax(0,1fr)]"
        data-testid={testId}
      >
        <Card className="order-3 rounded-2xl lg:order-1">
          <CardContent className="space-y-8 p-5">
            <h2 className="text-lg font-bold text-foreground">カテゴリ</h2>
            <div className="space-y-3">
              {MASTER_CATEGORIES.map((category) => {
                const active = category === activeCategory;
                return (
                  <button
                    key={category}
                    type="button"
                    disabled
                    aria-disabled="true"
                    className={[
                      'min-h-11 w-full rounded-xl border px-4 text-left text-base font-medium',
                      active
                        ? 'border-primary/20 bg-primary/10 text-primary'
                        : 'border-border bg-muted/35 text-muted-foreground',
                      'disabled:cursor-not-allowed disabled:opacity-80',
                    ].join(' ')}
                  >
                    {category}
                  </button>
                );
              })}
            </div>
          </CardContent>
        </Card>

        <Card className="order-1 rounded-2xl lg:order-2">
          <CardContent className="space-y-8 p-5">
            <h2 className="text-lg font-bold text-foreground">{listTitle}</h2>
            <div
              className="max-h-[240px] space-y-3 overflow-y-auto pr-1 lg:max-h-none lg:space-y-4 lg:overflow-visible lg:pr-0"
              aria-label={`${listTitle}のサンプル一覧`}
            >
              {masters.map((name) => (
                <button
                  key={name}
                  type="button"
                  disabled
                  aria-disabled="true"
                  className="flex min-h-12 w-full cursor-not-allowed items-center justify-between rounded-xl border border-border bg-muted/30 px-4 text-left opacity-90 lg:min-h-14"
                >
                  <span className="font-bold text-foreground">{name}</span>
                  <StateBadge role="readonly">サンプル</StateBadge>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="order-2 overflow-hidden rounded-2xl lg:order-3">
          <CardContent className="space-y-8 p-5">
            <h2 className="text-lg font-bold text-foreground">詳細を編集</h2>
            <div className="space-y-5">
              {MASTER_FIELDS.map((field) => (
                <label
                  key={field}
                  className="grid items-center gap-4 text-sm font-bold text-muted-foreground sm:grid-cols-[120px_minmax(0,1fr)]"
                >
                  <span>{field}</span>
                  <Input
                    className="!h-11 !min-h-11 rounded-xl"
                    aria-label={field}
                    aria-readonly="true"
                    disabled
                    readOnly
                    placeholder="サンプル表示では編集できません"
                  />
                </label>
              ))}
            </div>
            <div className="flex justify-end pt-4">
              <Button
                className="!h-11 !min-h-11 min-w-44"
                disabled
                aria-describedby="master-editor-save-note"
              >
                保存する
              </Button>
            </div>
            <p id="master-editor-save-note" className="text-right text-xs text-muted-foreground">
              サンプル表示のため保存できません。
            </p>
          </CardContent>
        </Card>
      </div>
    </PageScaffold>
  );
}
