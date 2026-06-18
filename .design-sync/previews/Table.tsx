import {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
} from 'ph-os';

export function VisitSchedule() {
  return (
    <div style={{ padding: 24, maxWidth: 620 }}>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>訪問時刻</TableHead>
            <TableHead>患者名</TableHead>
            <TableHead>住所</TableHead>
            <TableHead>担当薬剤師</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell>09:00</TableCell>
            <TableCell>山田 花子</TableCell>
            <TableCell>中央区本町2-4</TableCell>
            <TableCell>佐藤</TableCell>
          </TableRow>
          <TableRow>
            <TableCell>10:30</TableCell>
            <TableCell>鈴木 一郎</TableCell>
            <TableCell>港区芝5-1</TableCell>
            <TableCell>佐藤</TableCell>
          </TableRow>
          <TableRow>
            <TableCell>13:00</TableCell>
            <TableCell>田中 みどり</TableCell>
            <TableCell>新宿区西新宿7-2</TableCell>
            <TableCell>高橋</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>
  );
}

export function WithFooterAndCaption() {
  return (
    <div style={{ padding: 24, maxWidth: 620 }}>
      <Table>
        <TableCaption>2026年6月 在宅訪問件数の月次集計</TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead>区分</TableHead>
            <TableHead>件数</TableHead>
            <TableHead style={{ textAlign: 'right' }}>算定点数</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell>居宅療養管理指導</TableCell>
            <TableCell>42</TableCell>
            <TableCell style={{ textAlign: 'right' }}>20,580</TableCell>
          </TableRow>
          <TableRow>
            <TableCell>麻薬管理指導加算</TableCell>
            <TableCell>8</TableCell>
            <TableCell style={{ textAlign: 'right' }}>1,600</TableCell>
          </TableRow>
        </TableBody>
        <TableFooter>
          <TableRow>
            <TableCell>合計</TableCell>
            <TableCell>50</TableCell>
            <TableCell style={{ textAlign: 'right' }}>22,180</TableCell>
          </TableRow>
        </TableFooter>
      </Table>
    </div>
  );
}

export function SelectedRow() {
  return (
    <div style={{ padding: 24, maxWidth: 620 }}>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>処方薬</TableHead>
            <TableHead>用法</TableHead>
            <TableHead>残薬</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow data-state="selected">
            <TableCell>アムロジピン錠5mg</TableCell>
            <TableCell>分1 朝食後</TableCell>
            <TableCell>3日分</TableCell>
          </TableRow>
          <TableRow>
            <TableCell>メトホルミン錠250mg</TableCell>
            <TableCell>分2 朝夕食後</TableCell>
            <TableCell>0日分</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>
  );
}
