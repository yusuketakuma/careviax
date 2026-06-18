import { DataTable } from 'ph-os';

type PatientRow = {
  name: string;
  age: number;
  careLevel: string;
  nextVisit: string;
  pharmacist: string;
};

const columns = [
  { accessorKey: 'name', header: '患者名', meta: { label: '患者名' } },
  { accessorKey: 'age', header: '年齢', meta: { label: '年齢' } },
  { accessorKey: 'careLevel', header: '要介護度', meta: { label: '要介護度' } },
  { accessorKey: 'nextVisit', header: '次回訪問', meta: { label: '次回訪問' } },
  { accessorKey: 'pharmacist', header: '担当薬剤師', meta: { label: '担当薬剤師' } },
];

const rows: PatientRow[] = [
  { name: '山田 花子', age: 82, careLevel: '要介護3', nextVisit: '6/20', pharmacist: '佐藤' },
  { name: '鈴木 一郎', age: 76, careLevel: '要介護2', nextVisit: '6/21', pharmacist: '高橋' },
  { name: '田中 みどり', age: 88, careLevel: '要介護4', nextVisit: '6/22', pharmacist: '佐藤' },
  { name: '伊藤 健', age: 71, careLevel: '要支援2', nextVisit: '6/24', pharmacist: '渡辺' },
];

export function Default() {
  return (
    <div style={{ padding: 24, minWidth: 760 }}>
      <DataTable<PatientRow> columns={columns} data={rows} caption="在宅訪問患者一覧" />
    </div>
  );
}

export function WithToolbar() {
  return (
    <div style={{ padding: 24, minWidth: 760 }}>
      <DataTable<PatientRow>
        columns={columns}
        data={rows}
        toolbar={{
          enableGlobalFilter: true,
          globalFilterPlaceholder: '患者名・担当で絞り込み',
          enableColumnVisibility: true,
          enableExport: true,
          enablePrint: true,
        }}
      />
    </div>
  );
}

export function WithSelection() {
  return (
    <div style={{ padding: 24, minWidth: 760 }}>
      <DataTable<PatientRow> columns={columns} data={rows} enableRowSelection />
    </div>
  );
}

export function EmptyState() {
  return (
    <div style={{ padding: 24, minWidth: 760 }}>
      <DataTable<PatientRow>
        columns={columns}
        data={[]}
        emptyMessage="該当する訪問患者がいません"
      />
    </div>
  );
}

export function ErrorState() {
  return (
    <div style={{ padding: 24, minWidth: 760 }}>
      <DataTable<PatientRow>
        columns={columns}
        data={[]}
        errorMessage="患者データの取得に失敗しました。通信状況を確認してください。"
        errorActionLabel="再読み込み"
        onRetry={() => {}}
      />
    </div>
  );
}
