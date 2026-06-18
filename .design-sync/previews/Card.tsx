import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardAction,
  CardContent,
  CardFooter,
  Button,
} from 'ph-os';

export function PatientCard() {
  return (
    <div style={{ padding: 20, maxWidth: 400 }}>
      <Card>
        <CardHeader>
          <CardTitle>田中 一郎</CardTitle>
          <CardDescription helpTitle="患者区分について">
            要介護度と保険区分の判定基準を表示します。
          </CardDescription>
          <CardAction>
            <Button variant="ghost" size="sm">
              編集
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          <p style={{ fontSize: 14, fontWeight: 500, margin: '0 0 6px' }}>78歳 / 男性 / 要介護2</p>
          <p style={{ fontSize: 14, lineHeight: 1.7, margin: 0, color: 'var(--muted-foreground)' }}>
            次回訪問 2026/06/20 10:00。服薬指導と残薬確認を予定。前回訪問時に嚥下困難の訴えあり、一包化を検討。
          </p>
        </CardContent>
        <CardFooter>
          <Button size="sm">訪問記録を開く</Button>
        </CardFooter>
      </Card>
    </div>
  );
}

export function Stat() {
  return (
    <div style={{ padding: 20, maxWidth: 280 }}>
      <Card>
        <CardHeader>
          <CardTitle>本日の訪問予定</CardTitle>
        </CardHeader>
        <CardContent>
          <p style={{ fontSize: 30, fontWeight: 600, margin: '0 0 4px' }}>8 件</p>
          <p style={{ fontSize: 13, color: 'var(--muted-foreground)', margin: 0 }}>
            うち緊急対応 2 件 / 未確定 1 件
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
