import { PageScaffold } from '@/components/layout/page-scaffold';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function Loading() {
  return (
    <PageScaffold>
      <div className="space-y-6">
        <Card className="border-border/70 bg-card/95">
          <CardHeader>
            <CardTitle className="text-base">訪問候補ワークスペースを読み込み中...</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="h-10 animate-pulse rounded-xl bg-muted/60" />
              <div className="h-32 animate-pulse rounded-xl bg-muted/50" />
              <div className="h-64 animate-pulse rounded-xl bg-muted/40" />
            </div>
          </CardContent>
        </Card>
      </div>
    </PageScaffold>
  );
}
