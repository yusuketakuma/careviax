import { useFormContext } from 'react-hook-form';
import type { CreatePatientInput } from '@/lib/validations/patient';
import type { PatientCareCaseRevision } from './patient-form-occ';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { TabsContent } from '@/components/ui/tabs';
import {
  contactMethodOptions,
  emergencyResponseOptions,
  firstVisitSlotOptions,
  homeCareStatusOptions,
  housingTypeOptions,
  optionalBooleanFieldOptions,
  optionalNumberFieldOptions,
  optionalTextFieldOptions,
  requesterProfessionOptions,
  visitFrequencyOptions,
} from './patient-form-options';

export function PatientFormRequesterSection({
  patientId,
  selectedCareCase,
}: {
  patientId?: string;
  selectedCareCase: PatientCareCaseRevision | null;
}) {
  const { register } = useFormContext<CreatePatientInput>();
  return (
    <TabsContent value="requester" className="mt-2">
      <Card>
        <CardHeader className="py-4">
          <CardTitle className="text-base">紹介受付・依頼元</CardTitle>
        </CardHeader>
        <CardContent>
          <fieldset
            disabled={Boolean(patientId && !selectedCareCase)}
            aria-describedby={
              patientId && !selectedCareCase ? 'patient-care-case-unavailable' : undefined
            }
            className="space-y-4 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="requester.organization_name">依頼元事業所</Label>
                <Input
                  id="requester.organization_name"
                  {...register('requester.organization_name')}
                  placeholder="千代田クリニック"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="requester.profession">依頼元職種</Label>
                <select
                  id="requester.profession"
                  {...register('requester.profession')}
                  className="min-h-[44px] w-full rounded-lg border sm:h-9 sm:min-h-0 border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
                >
                  <option value="">未設定</option>
                  {requesterProfessionOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="requester.contact_name">依頼元担当者</Label>
                <Input
                  id="requester.contact_name"
                  {...register('requester.contact_name')}
                  placeholder="連携 太郎"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="requester.contact_name_kana">依頼元担当者フリガナ</Label>
                <Input
                  id="requester.contact_name_kana"
                  {...register('requester.contact_name_kana')}
                  placeholder="レンケイ タロウ"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="requester.phone">依頼元電話番号</Label>
                <Input
                  id="requester.phone"
                  type="tel"
                  {...register('requester.phone')}
                  placeholder="03-1111-2222"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="requester.fax">依頼元FAX</Label>
                <Input
                  id="requester.fax"
                  {...register('requester.fax')}
                  placeholder="03-1111-3333"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="requester.pharmacy_decision_due_date">薬局決定希望期限</Label>
                <Input
                  id="requester.pharmacy_decision_due_date"
                  type="date"
                  {...register('requester.pharmacy_decision_due_date', optionalTextFieldOptions)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="requester.preferred_contact_method">依頼元優先連絡手段</Label>
                <select
                  id="requester.preferred_contact_method"
                  {...register('requester.preferred_contact_method')}
                  className="min-h-[44px] w-full rounded-lg border sm:h-9 sm:min-h-0 border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
                >
                  <option value="">未設定</option>
                  {contactMethodOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="requester.preferred_contact_method_other">連絡手段補足</Label>
              <Input
                id="requester.preferred_contact_method_other"
                {...register('requester.preferred_contact_method_other')}
                placeholder="MCSグループ / 午後に連絡希望 など"
              />
            </div>
          </fieldset>
        </CardContent>
      </Card>
    </TabsContent>
  );
}

export function PatientFormVisitSection() {
  const { register } = useFormContext<CreatePatientInput>();
  return (
    <TabsContent id="patient-form-visit" value="visit" className="mt-2">
      <Card>
        <CardHeader className="py-4">
          <CardTitle className="text-base">訪問初期情報</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="intake.age">受付時年齢</Label>
              <Input
                id="intake.age"
                type="number"
                min={0}
                max={150}
                {...register('intake.age', optionalNumberFieldOptions)}
                placeholder="82"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="intake.primary_disease">主病名</Label>
              <Input
                id="intake.primary_disease"
                {...register('intake.primary_disease')}
                placeholder="慢性心不全"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="intake.postal_code">郵便番号</Label>
              <Input
                id="intake.postal_code"
                {...register('intake.postal_code')}
                placeholder="100-0001"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="intake.housing_type">住居形態</Label>
              <select
                id="intake.housing_type"
                {...register('intake.housing_type')}
                className="min-h-[44px] w-full rounded-lg border sm:h-9 sm:min-h-0 border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                <option value="">未設定</option>
                {housingTypeOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="intake.facility_name">施設名補足</Label>
              <Input
                id="intake.facility_name"
                {...register('intake.facility_name')}
                placeholder="あおば苑 本館"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="intake.mcs_linked">MCS連携</Label>
              <select
                id="intake.mcs_linked"
                {...register('intake.mcs_linked', optionalBooleanFieldOptions)}
                className="min-h-[44px] w-full rounded-lg border sm:h-9 sm:min-h-0 border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                <option value="">未設定</option>
                <option value="true">あり</option>
                <option value="false">なし</option>
              </select>
            </div>
          </div>

          <div className="space-y-3">
            <p className="text-sm font-medium text-foreground">在宅管理・現地情報</p>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
              <div className="space-y-1.5">
                <Label htmlFor="intake.home_care_status">在宅状態</Label>
                <select
                  id="intake.home_care_status"
                  {...register('intake.home_care_status', optionalTextFieldOptions)}
                  className="min-h-[44px] w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 sm:h-9 sm:min-h-0"
                >
                  <option value="">未設定</option>
                  {homeCareStatusOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="intake.home_start_date">在宅開始日</Label>
                <Input
                  id="intake.home_start_date"
                  type="date"
                  {...register('intake.home_start_date', optionalTextFieldOptions)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="intake.home_end_date">在宅終了日</Label>
                <Input
                  id="intake.home_end_date"
                  type="date"
                  {...register('intake.home_end_date', optionalTextFieldOptions)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="intake.home_end_reason">終了理由</Label>
                <Input
                  id="intake.home_end_reason"
                  {...register('intake.home_end_reason')}
                  placeholder="入院 / 施設入所 / 他薬局変更 など"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="intake.emergency_response">緊急対応</Label>
                <select
                  id="intake.emergency_response"
                  {...register('intake.emergency_response', optionalTextFieldOptions)}
                  className="min-h-[44px] w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 sm:h-9 sm:min-h-0"
                >
                  <option value="">未設定</option>
                  {emergencyResponseOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="intake.after_hours_explanation_date">時間外説明日</Label>
                <Input
                  id="intake.after_hours_explanation_date"
                  type="date"
                  {...register('intake.after_hours_explanation_date', optionalTextFieldOptions)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="intake.visit_frequency">訪問頻度</Label>
                <select
                  id="intake.visit_frequency"
                  {...register('intake.visit_frequency', optionalTextFieldOptions)}
                  className="min-h-[44px] w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 sm:h-9 sm:min-h-0"
                >
                  <option value="">未設定</option>
                  {visitFrequencyOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="intake.regular_visit_slot">定期訪問枠</Label>
                <Input
                  id="intake.regular_visit_slot"
                  {...register('intake.regular_visit_slot')}
                  placeholder="月曜午前 / 第2木曜午後 など"
                />
              </div>
              <div className="space-y-1.5 md:col-span-2">
                <Label htmlFor="intake.visit_available_time_note">訪問可能時間・不在時間</Label>
                <Input
                  id="intake.visit_available_time_note"
                  {...register('intake.visit_available_time_note')}
                  placeholder="デイ帰宅後 / 午前不在 など"
                />
              </div>
              <div className="space-y-1.5 md:col-span-2">
                <Label htmlFor="intake.access_key_info">玄関・鍵・現地注意</Label>
                <Input
                  id="intake.access_key_info"
                  {...register('intake.access_key_info')}
                  placeholder="オートロック / キーボックス / ペット注意 など"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="intake.medication_handover_place">受け渡し場所</Label>
                <Input
                  id="intake.medication_handover_place"
                  {...register('intake.medication_handover_place')}
                  placeholder="玄関 / 居室 / ナース室"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="intake.medication_storage_location">薬剤保管場所</Label>
                <Input
                  id="intake.medication_storage_location"
                  {...register('intake.medication_storage_location')}
                  placeholder="居室 / 冷蔵庫 / 金庫"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="intake.collection_method">集金方法</Label>
                <Input
                  id="intake.collection_method"
                  {...register('intake.collection_method')}
                  placeholder="現金 / 口座振替 / 施設請求"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="intake.payer">支払者</Label>
                <Input
                  id="intake.payer"
                  {...register('intake.payer')}
                  placeholder="本人 / 家族 / 施設"
                />
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <p className="text-sm font-medium text-foreground">患者連絡・訪問条件</p>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="intake.contact_phone">連絡先電話</Label>
                <Input
                  id="intake.contact_phone"
                  type="tel"
                  {...register('intake.contact_phone')}
                  placeholder="03-3333-4444"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="intake.contact_mobile">連絡先携帯</Label>
                <Input
                  id="intake.contact_mobile"
                  type="tel"
                  {...register('intake.contact_mobile')}
                  placeholder="090-1234-5678"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="intake.primary_contact_preference">主連絡先優先</Label>
                <select
                  id="intake.primary_contact_preference"
                  {...register('intake.primary_contact_preference')}
                  className="min-h-[44px] w-full rounded-lg border sm:h-9 sm:min-h-0 border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
                >
                  <option value="">未設定</option>
                  <option value="phone">電話優先</option>
                  <option value="mobile">携帯優先</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="intake.visit_before_contact_required">訪問前連絡</Label>
                <select
                  id="intake.visit_before_contact_required"
                  {...register('intake.visit_before_contact_required', optionalBooleanFieldOptions)}
                  className="min-h-[44px] w-full rounded-lg border sm:h-9 sm:min-h-0 border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
                >
                  <option value="">未設定</option>
                  <option value="true">要</option>
                  <option value="false">不要</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="intake.first_visit_preferred_date">初回訪問希望日</Label>
                <Input
                  id="intake.first_visit_preferred_date"
                  type="date"
                  {...register('intake.first_visit_preferred_date', optionalTextFieldOptions)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="intake.first_visit_time_slot">初回訪問時間帯</Label>
                <select
                  id="intake.first_visit_time_slot"
                  {...register('intake.first_visit_time_slot', optionalTextFieldOptions)}
                  className="min-h-[44px] w-full rounded-lg border sm:h-9 sm:min-h-0 border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
                >
                  <option value="">未設定</option>
                  {firstVisitSlotOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5 md:col-span-2">
                <Label htmlFor="intake.first_visit_time_note">初回訪問時間帯補足</Label>
                <Input
                  id="intake.first_visit_time_note"
                  {...register('intake.first_visit_time_note')}
                  placeholder="15時以降 / デイ帰宅後 など"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="intake.parking_available">駐車スペース</Label>
                <select
                  id="intake.parking_available"
                  {...register('intake.parking_available', optionalBooleanFieldOptions)}
                  className="min-h-[44px] w-full rounded-lg border sm:h-9 sm:min-h-0 border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
                >
                  <option value="">未設定</option>
                  <option value="true">あり</option>
                  <option value="false">なし</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="intake.initial_transition_management_expected">
                  初期移行管理料見込み
                </Label>
                <select
                  id="intake.initial_transition_management_expected"
                  {...register(
                    'intake.initial_transition_management_expected',
                    optionalBooleanFieldOptions,
                  )}
                  className="min-h-[44px] w-full rounded-lg border sm:h-9 sm:min-h-0 border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
                >
                  <option value="">未設定</option>
                  <option value="true">該当見込みあり</option>
                  <option value="false">該当見込みなし</option>
                </select>
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <p className="text-sm font-medium text-foreground">緊急連絡先</p>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="intake.emergency_contact.name">氏名</Label>
                <Input
                  id="intake.emergency_contact.name"
                  {...register('intake.emergency_contact.name')}
                  placeholder="家族 花子"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="intake.emergency_contact.relation">関係</Label>
                <Input
                  id="intake.emergency_contact.relation"
                  {...register('intake.emergency_contact.relation')}
                  placeholder="長女"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="intake.emergency_contact.phone">電話番号</Label>
                <Input
                  id="intake.emergency_contact.phone"
                  type="tel"
                  {...register('intake.emergency_contact.phone')}
                  placeholder="090-9876-5432"
                />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </TabsContent>
  );
}
