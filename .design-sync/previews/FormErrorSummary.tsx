import { FormErrorSummary } from 'ph-os';

const items = [
  { path: 'patientName', label: '患者氏名', message: '必須項目です。入力してください。' },
  { path: 'birthDate', label: '生年月日', message: '正しい日付を入力してください。' },
  { path: 'insuranceNumber', label: '保険者番号', message: '8桁の半角数字で入力してください。' },
  { path: 'careLevel', label: '要介護度', message: 'いずれかを選択してください。' },
];

export function WithMessages() {
  return (
    <div style={{ padding: 24, maxWidth: 560 }}>
      <FormErrorSummary items={items} />
    </div>
  );
}

export function LabelsOnly() {
  return (
    <div style={{ padding: 24, maxWidth: 560 }}>
      <FormErrorSummary items={items} showMessage={false} />
    </div>
  );
}

export function CompactChips() {
  return (
    <div style={{ padding: 24, maxWidth: 560 }}>
      <FormErrorSummary items={items} compact showMessage={false} />
    </div>
  );
}

export function SingleError() {
  return (
    <div style={{ padding: 24, maxWidth: 560 }}>
      <FormErrorSummary
        title="処方内容を確認してください"
        items={[
          {
            path: 'dosage',
            label: '用法・用量',
            message: '1日あたりの投与量が上限を超えています。',
          },
        ]}
      />
    </div>
  );
}
