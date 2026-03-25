import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

// --- Types ---

interface VisitProgressItem {
  patientName: string;
  medicalVisits: number;
  medicalTarget: number;
  careVisits: number;
  careTarget: number;
}

interface UnrecordedVisit {
  id: string;
  patientName: string;
  visitDate: string;
  pharmacistName: string;
}

interface UnsentReport {
  id: string;
  patientName: string;
  visitDate: string;
  reportType: string;
  daysSinceVisit: number;
}

interface WorkflowException {
  id: string;
  type: string;
  description: string;
  patientName: string;
  createdAt: string;
}

// --- Placeholder data (MVP: DB not yet available) ---

const visitProgressData: VisitProgressItem[] = [];
const unrecordedVisits: UnrecordedVisit[] = [];
const unsentReports: UnsentReport[] = [];
const workflowExceptions: WorkflowException[] = [];

// --- Components ---

function ProgressBar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  const color =
    pct >= 100
      ? 'bg-green-500'
      : pct >= 50
        ? 'bg-blue-500'
        : 'bg-orange-400';

  return (
    <div
      className="h-2 w-full overflow-hidden rounded-full bg-muted"
      role="progressbar"
      aria-valuenow={value}
      aria-valuemax={max}
      aria-valuemin={0}
    >
      <div className={`h-full ${color} transition-all`} style={{ width: `${pct}%` }} />
    </div>
  );
}

function VisitProgressSection() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">月間訪問回数進捗</CardTitle>
      </CardHeader>
      <CardContent>
        {visitProgressData.length === 0 ? (
          <p className="text-sm text-muted-foreground">データがありません。</p>
        ) : (
          <ul className="space-y-4" role="list">
            {visitProgressData.map((item) => (
              <li key={item.patientName}>
                <p className="mb-1 text-sm font-medium text-foreground">{item.patientName}</p>
                <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                  <div>
                    <span>医療: {item.medicalVisits}/{item.medicalTarget}回</span>
                    <ProgressBar value={item.medicalVisits} max={item.medicalTarget} />
                  </div>
                  <div>
                    <span>介護: {item.careVisits}/{item.careTarget}回</span>
                    <ProgressBar value={item.careVisits} max={item.careTarget} />
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function UnrecordedVisitsSection() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">未記録訪問</CardTitle>
      </CardHeader>
      <CardContent>
        {unrecordedVisits.length === 0 ? (
          <p className="text-sm text-muted-foreground">未記録の訪問はありません。</p>
        ) : (
          <ul className="divide-y divide-border" role="list">
            {unrecordedVisits.map((v) => (
              <li key={v.id} className="py-2">
                <p className="text-sm font-medium text-foreground">{v.patientName}</p>
                <p className="text-xs text-muted-foreground">
                  {v.visitDate} — {v.pharmacistName}
                </p>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function UnsentReportsSection() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">未送付報告書</CardTitle>
      </CardHeader>
      <CardContent>
        {unsentReports.length === 0 ? (
          <p className="text-sm text-muted-foreground">未送付の報告書はありません。</p>
        ) : (
          <ul className="divide-y divide-border" role="list">
            {unsentReports.map((r) => (
              <li key={r.id} className="flex items-center justify-between py-2">
                <div>
                  <p className="text-sm font-medium text-foreground">{r.patientName}</p>
                  <p className="text-xs text-muted-foreground">
                    {r.reportType} — {r.visitDate}
                  </p>
                </div>
                <Badge variant={r.daysSinceVisit > 7 ? 'destructive' : 'outline'}>
                  {r.daysSinceVisit}日経過
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function WorkflowExceptionsSection() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">ワークフロー例外（未解消）</CardTitle>
      </CardHeader>
      <CardContent>
        {workflowExceptions.length === 0 ? (
          <p className="text-sm text-muted-foreground">未解消の例外はありません。</p>
        ) : (
          <ul className="divide-y divide-border" role="list">
            {workflowExceptions.map((ex) => (
              <li key={ex.id} className="py-2">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium text-foreground">{ex.patientName}</p>
                    <p className="text-xs text-muted-foreground">{ex.description}</p>
                  </div>
                  <Badge variant="destructive">{ex.type}</Badge>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{ex.createdAt}</p>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

// --- Page ---

export default function AdminDashboardPage() {
  return (
    <div>
      <div className="border-b border-border px-6 py-4">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">管理者ダッシュボード</h1>
        <p className="mt-1 text-sm text-muted-foreground">月次進捗・例外管理</p>
      </div>

      <div className="p-6 space-y-6">
        <VisitProgressSection />

        <div className="grid gap-6 lg:grid-cols-3">
          <UnrecordedVisitsSection />
          <UnsentReportsSection />
          <WorkflowExceptionsSection />
        </div>
      </div>
    </div>
  );
}
