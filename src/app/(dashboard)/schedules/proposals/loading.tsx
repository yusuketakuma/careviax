import { PageScaffold } from '@/components/layout/page-scaffold';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/loading';

export default function Loading() {
  return (
    <PageScaffold>
      <div className="space-y-6">
        <Card className="border-border/70 bg-card/95">
          <CardHeader>
            <CardTitle className="text-base">訪問候補ワークスペースを読み込み中...</CardTitle>
          </CardHeader>
          <CardContent>
            <div
              role="status"
              aria-label="訪問候補ワークスペースを読み込み中"
              className="space-y-3"
            >
              <Skeleton className="h-10 rounded-xl bg-muted/60" />
              <Skeleton className="h-32 rounded-xl bg-muted/50" />
              <Skeleton className="h-64 rounded-xl bg-muted/40" />
              <span className="sr-only">訪問候補ワークスペースを読み込み中...</span>
            </div>
          </CardContent>
        </Card>
      </div>
    </PageScaffold>
  );
}
