import { useFormContext } from 'react-hook-form';
import type { CreatePatientInput } from '@/lib/validations/patient';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { TabsContent } from '@/components/ui/tabs';

export function PatientFormTeamSection() {
  const { register } = useFormContext<CreatePatientInput>();
  return (
    <TabsContent id="patient-form-team" value="team" className="mt-2">
      <Card>
        <CardHeader className="py-4">
          <CardTitle className="text-base">多職種連携</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-3">
            <p className="text-sm font-medium text-foreground">担当ケアマネジャー</p>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="intake.care_manager.name">氏名</Label>
                <Input
                  id="intake.care_manager.name"
                  {...register('intake.care_manager.name')}
                  placeholder="ケア 山田"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="intake.care_manager.name_kana">フリガナ</Label>
                <Input
                  id="intake.care_manager.name_kana"
                  {...register('intake.care_manager.name_kana')}
                  placeholder="ケア ヤマダ"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="intake.care_manager.organization_name">事業所名</Label>
                <Input
                  id="intake.care_manager.organization_name"
                  {...register('intake.care_manager.organization_name')}
                  placeholder="地域ケア支援センター"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="intake.care_manager.phone">電話番号</Label>
                <Input
                  id="intake.care_manager.phone"
                  type="tel"
                  {...register('intake.care_manager.phone')}
                  placeholder="03-9999-0000"
                />
              </div>
              <div className="space-y-1.5 md:col-span-2">
                <Label htmlFor="intake.care_manager.fax">FAX</Label>
                <Input
                  id="intake.care_manager.fax"
                  {...register('intake.care_manager.fax')}
                  placeholder="03-9999-0001"
                />
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <p className="text-sm font-medium text-foreground">訪問看護</p>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="intake.visiting_nurse.name">氏名</Label>
                <Input
                  id="intake.visiting_nurse.name"
                  {...register('intake.visiting_nurse.name')}
                  placeholder="看護 佐藤"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="intake.visiting_nurse.name_kana">フリガナ</Label>
                <Input
                  id="intake.visiting_nurse.name_kana"
                  {...register('intake.visiting_nurse.name_kana')}
                  placeholder="カンゴ サトウ"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="intake.visiting_nurse.organization_name">事業所名</Label>
                <Input
                  id="intake.visiting_nurse.organization_name"
                  {...register('intake.visiting_nurse.organization_name')}
                  placeholder="訪問看護ステーションあおば"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="intake.visiting_nurse.phone">電話番号</Label>
                <Input
                  id="intake.visiting_nurse.phone"
                  type="tel"
                  {...register('intake.visiting_nurse.phone')}
                  placeholder="03-8888-7777"
                />
              </div>
              <div className="space-y-1.5 md:col-span-2">
                <Label htmlFor="intake.visiting_nurse.fax">FAX</Label>
                <Input
                  id="intake.visiting_nurse.fax"
                  {...register('intake.visiting_nurse.fax')}
                  placeholder="03-8888-7778"
                />
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <p className="text-sm font-medium text-foreground">連携ルール・書類</p>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="intake.report_destination_note">報告書送付先・頻度</Label>
                <Textarea
                  id="intake.report_destination_note"
                  {...register('intake.report_destination_note')}
                  rows={2}
                  placeholder="医師・CMへ毎回 / 訪看へ変化時のみ など"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="intake.document_status_note">書類・期限メモ</Label>
                <Textarea
                  id="intake.document_status_note"
                  {...register('intake.document_status_note')}
                  rows={2}
                  placeholder="同意書未取得 / 計画書更新 6/30 / 報告書送付済 など"
                />
              </div>
              <div className="space-y-1.5 md:col-span-2">
                <Label htmlFor="intake.interprofessional_action_note">連携ログ・次アクション</Label>
                <Textarea
                  id="intake.interprofessional_action_note"
                  {...register('intake.interprofessional_action_note')}
                  rows={2}
                  placeholder="訪看へ残薬共有 / 主治医へ便秘対策相談 / CMへ集金方法確認 など"
                />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </TabsContent>
  );
}
