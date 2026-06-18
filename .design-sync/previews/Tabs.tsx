import { Tabs, TabsList, TabsTrigger, TabsContent } from 'ph-os';

export function Default() {
  return (
    <div style={{ padding: 24, maxWidth: 560 }}>
      <Tabs defaultValue="prescription">
        <TabsList>
          <TabsTrigger value="prescription">処方</TabsTrigger>
          <TabsTrigger value="medication">服薬指導</TabsTrigger>
          <TabsTrigger value="vitals">バイタル</TabsTrigger>
        </TabsList>
        <TabsContent value="prescription">
          <div style={{ padding: '12px 4px', fontSize: 13, color: '#334155' }}>
            アムロジピン錠5mg 1錠 / 分1 朝食後 28日分
          </div>
        </TabsContent>
        <TabsContent value="medication">
          <div style={{ padding: '12px 4px', fontSize: 13, color: '#334155' }}>
            血圧の自己測定値を確認。ふらつきの訴えなし。
          </div>
        </TabsContent>
        <TabsContent value="vitals">
          <div style={{ padding: '12px 4px', fontSize: 13, color: '#334155' }}>
            血圧 128/76 / 脈拍 72 / 体温 36.4℃
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

export function LineVariant() {
  return (
    <div style={{ padding: 24, maxWidth: 560 }}>
      <Tabs defaultValue="active">
        <TabsList variant="line">
          <TabsTrigger value="active">稼働中</TabsTrigger>
          <TabsTrigger value="pending">保留</TabsTrigger>
          <TabsTrigger value="closed">終了</TabsTrigger>
        </TabsList>
        <TabsContent value="active">
          <div style={{ padding: '12px 4px', fontSize: 13, color: '#334155' }}>
            稼働中の在宅患者 24名を表示しています。
          </div>
        </TabsContent>
        <TabsContent value="pending">
          <div style={{ padding: '12px 4px', fontSize: 13, color: '#334155' }}>
            入院等で保留中の患者 3名。
          </div>
        </TabsContent>
        <TabsContent value="closed">
          <div style={{ padding: '12px 4px', fontSize: 13, color: '#334155' }}>
            訪問終了した患者の履歴。
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

export function Vertical() {
  return (
    <div style={{ padding: 24, maxWidth: 560 }}>
      <Tabs defaultValue="basic" orientation="vertical">
        <TabsList>
          <TabsTrigger value="basic">基本情報</TabsTrigger>
          <TabsTrigger value="allergy">アレルギー</TabsTrigger>
          <TabsTrigger value="history">既往歴</TabsTrigger>
        </TabsList>
        <TabsContent value="basic">
          <div style={{ padding: '4px 12px', fontSize: 13, color: '#334155' }}>
            山田 花子 / 82歳 / 要介護度3
          </div>
        </TabsContent>
        <TabsContent value="allergy">
          <div style={{ padding: '4px 12px', fontSize: 13, color: '#334155' }}>
            ペニシリン系: 発疹歴あり
          </div>
        </TabsContent>
        <TabsContent value="history">
          <div style={{ padding: '4px 12px', fontSize: 13, color: '#334155' }}>
            高血圧症 / 2型糖尿病
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
