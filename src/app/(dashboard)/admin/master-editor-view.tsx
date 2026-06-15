'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { PageScaffold } from '@/components/layout/page-scaffold';

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
      <div
        className="grid min-h-[720px] gap-7 xl:grid-cols-[280px_430px_minmax(0,1fr)]"
        data-testid={testId}
      >
        <Card className="rounded-2xl">
          <CardContent className="space-y-8 p-5">
            <h2 className="text-lg font-bold text-foreground">カテゴリ</h2>
            <div className="space-y-3">
              {MASTER_CATEGORIES.map((category) => {
                const active = category === activeCategory;
                return (
                  <button
                    key={category}
                    type="button"
                    className={[
                      'min-h-11 w-full rounded-xl border px-4 text-left text-base font-medium',
                      active
                        ? 'border-primary/20 bg-primary/10 text-primary'
                        : 'border-border bg-background text-foreground',
                    ].join(' ')}
                  >
                    {category}
                  </button>
                );
              })}
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-2xl">
          <CardContent className="space-y-8 p-5">
            <h2 className="text-lg font-bold text-foreground">{listTitle}</h2>
            <div className="space-y-4">
              {masters.map((name) => (
                <button
                  key={name}
                  type="button"
                  className="flex min-h-14 w-full items-center justify-between rounded-xl border border-border bg-background px-4 text-left"
                >
                  <span className="font-bold text-foreground">{name}</span>
                  <span className="text-sm font-medium text-emerald-600">有効</span>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="overflow-hidden rounded-2xl">
          <CardContent className="space-y-8 p-5">
            <h2 className="text-lg font-bold text-foreground">詳細を編集</h2>
            <div className="space-y-5">
              {MASTER_FIELDS.map((field) => (
                <label
                  key={field}
                  className="grid items-center gap-4 text-sm font-bold text-muted-foreground sm:grid-cols-[120px_minmax(0,1fr)]"
                >
                  <span>{field}</span>
                  <Input className="h-11 rounded-xl" aria-label={field} />
                </label>
              ))}
            </div>
            <div className="flex justify-end pt-4">
              <Button className="min-h-11 min-w-44">保存する</Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </PageScaffold>
  );
}
