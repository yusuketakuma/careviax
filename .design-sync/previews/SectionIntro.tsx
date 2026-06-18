import { SectionIntro } from 'ph-os';

export function Default() {
  return (
    <div style={{ padding: 24, maxWidth: 480 }}>
      <SectionIntro
        title="服薬状況"
        description="患者の残薬・服薬コンプライアンスを記録します。次回訪問時の指導方針の判断材料になります。"
      />
    </div>
  );
}

export function Multiple() {
  return (
    <div style={{ padding: 24, maxWidth: 480, display: 'flex', flexDirection: 'column', gap: 24 }}>
      <SectionIntro
        title="処方内容"
        description="今回交付した処方薬の一覧です。一般名処方と銘柄処方を区別して記載します。"
      />
      <SectionIntro
        title="疑義照会"
        description="処方医への照会内容と回答を記録します。回答内容は監査ログに残ります。"
      />
    </div>
  );
}
