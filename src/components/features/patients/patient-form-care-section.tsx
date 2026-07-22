import { useFormContext, useWatch } from 'react-hook-form';
import type { CreatePatientInput } from '@/lib/validations/patient';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { TabsContent } from '@/components/ui/tabs';
import {
  adlOptions,
  addOn2CandidateOptions,
  asepticPreparationNeedOptions,
  careLevelOptions,
  confirmationStatusOptions,
  dementiaOptions,
  homeCareBillingCategoryOptions,
  medicalHomeManagementSectionOptions,
  medicalHomeManagementTypeOptions,
  medicationManagerOptions,
  medicationSupportOptions,
  moneyManagementOptions,
  narcoticUseCategoryOptions,
  optionalBooleanFieldOptions,
  optionalTextFieldOptions,
  singleBuildingCountOptions,
  specialProcedureOptions,
  supportStatusOptions,
  triageRiskOptions,
  visitingNurseFrequencyOptions,
} from './patient-form-options';

export function PatientFormCareSection({
  caseOwnedFieldsDisabled = false,
}: {
  caseOwnedFieldsDisabled?: boolean;
}) {
  const { register, control, setValue } = useFormContext<CreatePatientInput>();
  const watchedMedicationSupportMethods =
    useWatch({ control, name: 'intake.medication_support_methods' }) ?? [];
  const watchedSpecialProcedures =
    useWatch({ control, name: 'intake.special_medical_procedures' }) ?? [];
  const watchedNarcoticUseCategories =
    useWatch({ control, name: 'intake.home_pharmacy_add_on_2.narcotic_use_categories' }) ?? [];
  function toggleStringArrayField(
    field:
      | 'intake.medication_support_methods'
      | 'intake.special_medical_procedures'
      | 'intake.home_pharmacy_add_on_2.narcotic_use_categories',
    currentValues: string[],
    value: string,
    checked: boolean,
  ) {
    const nextValues = checked
      ? Array.from(new Set([...currentValues, value]))
      : currentValues.filter((item) => item !== value);
    setValue(field, nextValues, { shouldDirty: true });
  }
  return (
    <TabsContent id="patient-form-care" value="care" className="mt-2">
      <Card>
        <CardHeader className="py-4">
          <CardTitle className="text-base">生活背景・薬学的管理</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-3">
            <p className="text-sm font-medium text-foreground">生活背景</p>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
              <div className="space-y-1.5">
                <Label htmlFor="intake.care_level">介護認定</Label>
                <select
                  id="intake.care_level"
                  {...register('intake.care_level')}
                  className="min-h-[44px] w-full rounded-lg border sm:h-9 sm:min-h-0 border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
                >
                  <option value="">未設定</option>
                  {careLevelOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="intake.money_management">金銭管理</Label>
                <select
                  id="intake.money_management"
                  {...register('intake.money_management')}
                  className="min-h-[44px] w-full rounded-lg border sm:h-9 sm:min-h-0 border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
                >
                  <option value="">未設定</option>
                  {moneyManagementOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="intake.adl_level">ADL</Label>
                <select
                  id="intake.adl_level"
                  {...register('intake.adl_level')}
                  className="min-h-[44px] w-full rounded-lg border sm:h-9 sm:min-h-0 border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
                >
                  <option value="">未設定</option>
                  {adlOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="intake.dementia_level">認知症自立度</Label>
                <select
                  id="intake.dementia_level"
                  {...register('intake.dementia_level')}
                  className="min-h-[44px] w-full rounded-lg border sm:h-9 sm:min-h-0 border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
                >
                  <option value="">未設定</option>
                  {dementiaOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5 md:col-span-2">
                <Label htmlFor="intake.family_key_person">家族構成・キーパーソン</Label>
                <Textarea
                  id="intake.family_key_person"
                  {...register('intake.family_key_person')}
                  rows={2}
                  placeholder="長女が服薬管理を支援 / 長男が主連絡先 など"
                />
              </div>
              {[
                ['pediatric_home_care', '小児在宅'] as const,
                ['infant_add_on_candidate', '乳幼児加算候補'] as const,
                ['medical_care_child', '医療的ケア児'] as const,
                ['weekly_visiting_nurse', '訪問看護週1以上'] as const,
              ].map(([field, label]) => (
                <div key={field} className="space-y-1.5">
                  <Label htmlFor={`intake.home_pharmacy_add_on_2.${field}`}>{label}</Label>
                  <select
                    id={`intake.home_pharmacy_add_on_2.${field}`}
                    {...register(
                      `intake.home_pharmacy_add_on_2.${field}`,
                      optionalTextFieldOptions,
                    )}
                    className="min-h-[44px] w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 sm:h-9 sm:min-h-0"
                  >
                    <option value="">未設定</option>
                    {confirmationStatusOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
              <div className="space-y-1.5">
                <Label htmlFor="intake.home_pharmacy_add_on_2.visiting_nurse_frequency">
                  訪問看護頻度
                </Label>
                <select
                  id="intake.home_pharmacy_add_on_2.visiting_nurse_frequency"
                  {...register(
                    'intake.home_pharmacy_add_on_2.visiting_nurse_frequency',
                    optionalTextFieldOptions,
                  )}
                  className="min-h-[44px] w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 sm:h-9 sm:min-h-0"
                >
                  <option value="">未設定</option>
                  {visitingNurseFrequencyOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="intake.home_pharmacy_add_on_2.nursing_or_family_procedure">
                  看護・家族処置
                </Label>
                <select
                  id="intake.home_pharmacy_add_on_2.nursing_or_family_procedure"
                  {...register(
                    'intake.home_pharmacy_add_on_2.nursing_or_family_procedure',
                    optionalTextFieldOptions,
                  )}
                  className="min-h-[44px] w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 sm:h-9 sm:min-h-0"
                >
                  <option value="">未設定</option>
                  {confirmationStatusOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <p className="text-sm font-medium text-foreground">算定前提</p>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="intake.home_pharmacy_add_on_2.candidate">候補区分</Label>
                <select
                  id="intake.home_pharmacy_add_on_2.candidate"
                  {...register('intake.home_pharmacy_add_on_2.candidate', optionalTextFieldOptions)}
                  className="min-h-[44px] w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 sm:h-9 sm:min-h-0"
                >
                  <option value="">未設定</option>
                  {addOn2CandidateOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="intake.home_pharmacy_add_on_2.home_care_billing_category">
                  算定対象
                </Label>
                <select
                  id="intake.home_pharmacy_add_on_2.home_care_billing_category"
                  {...register(
                    'intake.home_pharmacy_add_on_2.home_care_billing_category',
                    optionalTextFieldOptions,
                  )}
                  className="min-h-[44px] w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 sm:h-9 sm:min-h-0"
                >
                  <option value="">未設定</option>
                  {homeCareBillingCategoryOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="intake.home_pharmacy_add_on_2.comprehensive_support_add_on">
                  包括的支援加算
                </Label>
                <select
                  id="intake.home_pharmacy_add_on_2.comprehensive_support_add_on"
                  {...register(
                    'intake.home_pharmacy_add_on_2.comprehensive_support_add_on',
                    optionalTextFieldOptions,
                  )}
                  className="min-h-[44px] w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 sm:h-9 sm:min-h-0"
                >
                  <option value="">未設定</option>
                  {confirmationStatusOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="intake.home_pharmacy_add_on_2.single_building_medical_patient_count">
                  単一建物の医療患者数
                </Label>
                <select
                  id="intake.home_pharmacy_add_on_2.single_building_medical_patient_count"
                  {...register(
                    'intake.home_pharmacy_add_on_2.single_building_medical_patient_count',
                    optionalTextFieldOptions,
                  )}
                  className="min-h-[44px] w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 sm:h-9 sm:min-h-0"
                >
                  <option value="">未設定</option>
                  {singleBuildingCountOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="intake.home_pharmacy_add_on_2.single_building_resident_count">
                  単一建物の居住者数
                </Label>
                <select
                  id="intake.home_pharmacy_add_on_2.single_building_resident_count"
                  {...register(
                    'intake.home_pharmacy_add_on_2.single_building_resident_count',
                    optionalTextFieldOptions,
                  )}
                  className="min-h-[44px] w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 sm:h-9 sm:min-h-0"
                >
                  <option value="">未設定</option>
                  {singleBuildingCountOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="intake.home_pharmacy_add_on_2.medical_home_management_type">
                  医学管理
                </Label>
                <select
                  id="intake.home_pharmacy_add_on_2.medical_home_management_type"
                  {...register(
                    'intake.home_pharmacy_add_on_2.medical_home_management_type',
                    optionalTextFieldOptions,
                  )}
                  className="min-h-[44px] w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 sm:h-9 sm:min-h-0"
                >
                  <option value="">未設定</option>
                  {medicalHomeManagementTypeOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="intake.home_pharmacy_add_on_2.medical_home_management_section">
                  医学管理区分
                </Label>
                <select
                  id="intake.home_pharmacy_add_on_2.medical_home_management_section"
                  {...register(
                    'intake.home_pharmacy_add_on_2.medical_home_management_section',
                    optionalTextFieldOptions,
                  )}
                  className="min-h-[44px] w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 sm:h-9 sm:min-h-0"
                >
                  <option value="">未設定</option>
                  {medicalHomeManagementSectionOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="intake.home_pharmacy_add_on_2.table_8_2_applicable">別表8の2</Label>
                <select
                  id="intake.home_pharmacy_add_on_2.table_8_2_applicable"
                  {...register(
                    'intake.home_pharmacy_add_on_2.table_8_2_applicable',
                    optionalTextFieldOptions,
                  )}
                  className="min-h-[44px] w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 sm:h-9 sm:min-h-0"
                >
                  <option value="">未設定</option>
                  {confirmationStatusOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="intake.home_pharmacy_add_on_2.table_8_3_applicable">別表8の3</Label>
                <select
                  id="intake.home_pharmacy_add_on_2.table_8_3_applicable"
                  {...register(
                    'intake.home_pharmacy_add_on_2.table_8_3_applicable',
                    optionalTextFieldOptions,
                  )}
                  className="min-h-[44px] w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 sm:h-9 sm:min-h-0"
                >
                  <option value="">未設定</option>
                  {confirmationStatusOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <p className="text-sm font-medium text-foreground">服薬支援</p>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="intake.medication_manager">服薬管理者</Label>
                <select
                  id="intake.medication_manager"
                  {...register('intake.medication_manager', optionalTextFieldOptions)}
                  className="min-h-[44px] w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 sm:h-9 sm:min-h-0"
                >
                  <option value="">未設定</option>
                  {medicationManagerOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="intake.medication_ability">服薬能力</Label>
                <Input
                  id="intake.medication_ability"
                  {...register('intake.medication_ability')}
                  placeholder="自立 / 一部介助 / 全介助"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="intake.missed_dose_pattern">飲み忘れ傾向</Label>
                <Input
                  id="intake.missed_dose_pattern"
                  {...register('intake.missed_dose_pattern')}
                  placeholder="朝 / 夕 / 眠前 / 頓服 など"
                />
              </div>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              {medicationSupportOptions.map((option) => (
                <label
                  key={option.value}
                  className="flex items-start gap-3 rounded-lg border border-border/70 px-3 py-2 text-sm"
                >
                  <Checkbox
                    disabled={caseOwnedFieldsDisabled}
                    aria-describedby={
                      caseOwnedFieldsDisabled ? 'patient-care-case-unavailable' : undefined
                    }
                    checked={watchedMedicationSupportMethods.includes(option.value)}
                    onCheckedChange={(checked) =>
                      toggleStringArrayField(
                        'intake.medication_support_methods',
                        watchedMedicationSupportMethods,
                        option.value,
                        checked === true,
                      )
                    }
                  />
                  <span>{option.label}</span>
                </label>
              ))}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="intake.medication_support_other">服薬支援補足</Label>
              <Input
                id="intake.medication_support_other"
                {...register('intake.medication_support_other')}
                placeholder="自己管理困難時は家族同席 など"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="intake.residual_medication_status">残薬状況</Label>
              <Input
                id="intake.residual_medication_status"
                {...register('intake.residual_medication_status')}
                placeholder="残薬多い / 整理済み など"
              />
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="intake.residual_medication_pattern">残薬パターン</Label>
                <Input
                  id="intake.residual_medication_pattern"
                  {...register('intake.residual_medication_pattern')}
                  placeholder="全体 / 特定薬剤 / 頓服 / 外用"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="intake.residual_medication_checked_on">残薬確認日</Label>
                <Input
                  id="intake.residual_medication_checked_on"
                  type="date"
                  {...register('intake.residual_medication_checked_on', optionalTextFieldOptions)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="intake.residual_adjustment_status">残薬調整提案</Label>
                <select
                  id="intake.residual_adjustment_status"
                  {...register('intake.residual_adjustment_status', optionalTextFieldOptions)}
                  className="min-h-[44px] w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 sm:h-9 sm:min-h-0"
                >
                  <option value="">未設定</option>
                  {supportStatusOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="intake.crushing_check_status">粉砕可否</Label>
                <select
                  id="intake.crushing_check_status"
                  {...register('intake.crushing_check_status', optionalTextFieldOptions)}
                  className="min-h-[44px] w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 sm:h-9 sm:min-h-0"
                >
                  <option value="">未設定</option>
                  {confirmationStatusOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="intake.simple_suspension_check_status">簡易懸濁可否</Label>
                <select
                  id="intake.simple_suspension_check_status"
                  {...register('intake.simple_suspension_check_status', optionalTextFieldOptions)}
                  className="min-h-[44px] w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 sm:h-9 sm:min-h-0"
                >
                  <option value="">未設定</option>
                  {confirmationStatusOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="intake.fall_risk">転倒リスク</Label>
                <select
                  id="intake.fall_risk"
                  {...register('intake.fall_risk', optionalTextFieldOptions)}
                  className="min-h-[44px] w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 sm:h-9 sm:min-h-0"
                >
                  <option value="">未設定</option>
                  {triageRiskOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <p className="text-sm font-medium text-foreground">医療処置</p>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="intake.ent_prescription">ENT処方</Label>
                <select
                  id="intake.ent_prescription"
                  {...register('intake.ent_prescription', optionalBooleanFieldOptions)}
                  className="min-h-[44px] w-full rounded-lg border sm:h-9 sm:min-h-0 border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
                >
                  <option value="">未設定</option>
                  <option value="true">あり</option>
                  <option value="false">なし</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="intake.swallowing_route">嚥下・投与経路</Label>
                <Input
                  id="intake.swallowing_route"
                  {...register('intake.swallowing_route')}
                  placeholder="経口 / 胃ろう / 経管 など"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="intake.ent_period_from">ENT開始日</Label>
                <Input
                  id="intake.ent_period_from"
                  type="date"
                  {...register('intake.ent_period_from', optionalTextFieldOptions)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="intake.ent_period_to">ENT終了日</Label>
                <Input
                  id="intake.ent_period_to"
                  type="date"
                  {...register('intake.ent_period_to', optionalTextFieldOptions)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="intake.narcotics_base">麻薬ベース</Label>
                <select
                  id="intake.narcotics_base"
                  {...register('intake.narcotics_base', optionalBooleanFieldOptions)}
                  className="min-h-[44px] w-full rounded-lg border sm:h-9 sm:min-h-0 border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
                >
                  <option value="">未設定</option>
                  <option value="true">あり</option>
                  <option value="false">なし</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="intake.narcotics_rescue">麻薬レスキュー</Label>
                <select
                  id="intake.narcotics_rescue"
                  {...register('intake.narcotics_rescue', optionalBooleanFieldOptions)}
                  className="min-h-[44px] w-full rounded-lg border sm:h-9 sm:min-h-0 border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
                >
                  <option value="">未設定</option>
                  <option value="true">あり</option>
                  <option value="false">なし</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="intake.infection_isolation">感染症・隔離</Label>
                <Input
                  id="intake.infection_isolation"
                  {...register('intake.infection_isolation')}
                  placeholder="接触 / 飛沫 / 空気 など"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="intake.home_pharmacy_add_on_2.aseptic_preparation_need">
                  無菌調製の要否
                </Label>
                <select
                  id="intake.home_pharmacy_add_on_2.aseptic_preparation_need"
                  {...register(
                    'intake.home_pharmacy_add_on_2.aseptic_preparation_need',
                    optionalTextFieldOptions,
                  )}
                  className="min-h-[44px] w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 sm:h-9 sm:min-h-0"
                >
                  <option value="">未設定</option>
                  {asepticPreparationNeedOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="intake.home_pharmacy_add_on_2.medical_material_supply">
                  医療材料供給
                </Label>
                <select
                  id="intake.home_pharmacy_add_on_2.medical_material_supply"
                  {...register(
                    'intake.home_pharmacy_add_on_2.medical_material_supply',
                    optionalTextFieldOptions,
                  )}
                  className="min-h-[44px] w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 sm:h-9 sm:min-h-0"
                >
                  <option value="">未設定</option>
                  {confirmationStatusOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="intake.home_pharmacy_add_on_2.advanced_medical_device">
                  高度医療機器
                </Label>
                <select
                  id="intake.home_pharmacy_add_on_2.advanced_medical_device"
                  {...register(
                    'intake.home_pharmacy_add_on_2.advanced_medical_device',
                    optionalTextFieldOptions,
                  )}
                  className="min-h-[44px] w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 sm:h-9 sm:min-h-0"
                >
                  <option value="">未設定</option>
                  {confirmationStatusOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="space-y-1.5">
              <p className="text-sm font-medium text-foreground">麻薬区分</p>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
                {narcoticUseCategoryOptions.map((option) => (
                  <label
                    key={option.value}
                    className="flex items-start gap-2 rounded-lg border border-border/70 px-3 py-2 text-sm"
                  >
                    <Checkbox
                      disabled={caseOwnedFieldsDisabled}
                      aria-describedby={
                        caseOwnedFieldsDisabled ? 'patient-care-case-unavailable' : undefined
                      }
                      checked={watchedNarcoticUseCategories.includes(option.value)}
                      onCheckedChange={(checked) =>
                        toggleStringArrayField(
                          'intake.home_pharmacy_add_on_2.narcotic_use_categories',
                          watchedNarcoticUseCategories,
                          option.value,
                          checked === true,
                        )
                      }
                    />
                    <span>{option.label}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
              <div className="space-y-1.5">
                <Label htmlFor="intake.pain_score">疼痛スコア</Label>
                <Input
                  id="intake.pain_score"
                  {...register('intake.pain_score')}
                  placeholder="NRS 0-10"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="intake.rescue_use_count_recent">レスキュー使用</Label>
                <Input
                  id="intake.rescue_use_count_recent"
                  {...register('intake.rescue_use_count_recent')}
                  placeholder="直近24h 2回 / 3日で5回"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="intake.constipation_status">便秘対策</Label>
                <Input
                  id="intake.constipation_status"
                  {...register('intake.constipation_status')}
                  placeholder="下剤あり / 最終排便 など"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="intake.drowsiness_delirium_status">眠気・せん妄</Label>
                <Input
                  id="intake.drowsiness_delirium_status"
                  {...register('intake.drowsiness_delirium_status')}
                  placeholder="なし / 軽度 / 要観察"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="intake.egfr_value">eGFR</Label>
                <Input id="intake.egfr_value" {...register('intake.egfr_value')} placeholder="38" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="intake.egfr_measured_on">eGFR測定日</Label>
                <Input
                  id="intake.egfr_measured_on"
                  type="date"
                  {...register('intake.egfr_measured_on', optionalTextFieldOptions)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="intake.weight_kg">体重</Label>
                <Input
                  id="intake.weight_kg"
                  {...register('intake.weight_kg')}
                  placeholder="45.2kg"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="intake.weight_measured_on">体重測定日</Label>
                <Input
                  id="intake.weight_measured_on"
                  type="date"
                  {...register('intake.weight_measured_on', optionalTextFieldOptions)}
                />
              </div>
              <div className="space-y-1.5 md:col-span-2">
                <Label htmlFor="intake.medical_material_supplier">医療材料供給担当</Label>
                <Input
                  id="intake.medical_material_supplier"
                  {...register('intake.medical_material_supplier')}
                  placeholder="薬局 / 訪看 / 医療機関 / 業者"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="intake.material_exchange_due_note">交換期限</Label>
                <Input
                  id="intake.material_exchange_due_note"
                  {...register('intake.material_exchange_due_note')}
                  placeholder="ルート交換 6/20 など"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="intake.device_vendor_contact">業者連絡先</Label>
                <Input
                  id="intake.device_vendor_contact"
                  {...register('intake.device_vendor_contact')}
                  placeholder="酸素業者 / ポンプ業者"
                />
              </div>
              <div className="space-y-1.5 md:col-span-2">
                <Label htmlFor="intake.pressure_ulcer_status">褥瘡・創傷</Label>
                <Input
                  id="intake.pressure_ulcer_status"
                  {...register('intake.pressure_ulcer_status')}
                  placeholder="仙骨 / DESIGN-R / 処置材料 など"
                />
              </div>
              <div className="space-y-1.5 md:col-span-2">
                <Label htmlFor="intake.emergency_policy_note">緊急時方針</Label>
                <Input
                  id="intake.emergency_policy_note"
                  {...register('intake.emergency_policy_note')}
                  placeholder="まず主治医 / 訪看へ連絡 / 搬送希望 など"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="intake.allergy_history">アレルギー・副作用歴</Label>
              <Textarea
                id="intake.allergy_history"
                {...register('intake.allergy_history')}
                rows={2}
                placeholder="ペニシリンで発疹 など"
              />
            </div>

            <div className="space-y-3">
              <p className="text-sm font-medium text-foreground">特別な医療・処置</p>
              <div className="grid gap-3 md:grid-cols-2">
                {specialProcedureOptions.map((option) => (
                  <label
                    key={option.value}
                    className="flex items-start gap-3 rounded-lg border border-border/70 px-3 py-2 text-sm"
                  >
                    <Checkbox
                      disabled={caseOwnedFieldsDisabled}
                      aria-describedby={
                        caseOwnedFieldsDisabled ? 'patient-care-case-unavailable' : undefined
                      }
                      checked={watchedSpecialProcedures.includes(option.value)}
                      onCheckedChange={(checked) =>
                        toggleStringArrayField(
                          'intake.special_medical_procedures',
                          watchedSpecialProcedures,
                          option.value,
                          checked === true,
                        )
                      }
                    />
                    <span>{option.label}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="intake.special_medical_notes">特別処置の配慮事項</Label>
                <Textarea
                  id="intake.special_medical_notes"
                  {...register('intake.special_medical_notes')}
                  rows={2}
                  placeholder="酸素ボンベ残量確認 / 麻薬金庫あり など"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="intake.other_clinical_notes">臨床メモ</Label>
                <Textarea
                  id="intake.other_clinical_notes"
                  {...register('intake.other_clinical_notes')}
                  rows={2}
                  placeholder="血圧変動あり / 浮腫観察必要 など"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="intake.intake_note">受付メモ</Label>
                <Textarea
                  id="intake.intake_note"
                  {...register('intake.intake_note')}
                  rows={2}
                  placeholder="初回は家族同席希望 / 夕方帯で調整 など"
                />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </TabsContent>
  );
}
