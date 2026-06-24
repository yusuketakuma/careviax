'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { StateBadge } from '@/components/ui/state-badge';
import { PageScaffold } from '@/components/layout/page-scaffold';
import { AdminPageHeader } from '@/components/features/admin/admin-page-header';
import { SectionIntro } from '@/components/ui/section-intro';

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
          <SectionIntro
            title="サンプル表示"
            description="実データ接続は未実装です。表示は固定のサンプルで、登録・編集操作は保存されません。"
          />
        }
      />
      <div
        className="grid min-h-[calc(100dvh-16rem)] gap-7 lg:grid-cols-[220px_340px_minmax(0,1fr)] xl:grid-cols-[280px_430px_minmax(0,1fr)]"
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
                  <StateBadge role="done">有効</StateBadge>
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
