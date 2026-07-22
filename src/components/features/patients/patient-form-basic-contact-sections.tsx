import { useFormContext, type FieldPath } from 'react-hook-form';
import { AlertTriangle, ShieldCheck } from 'lucide-react';
import type { CreatePatientInput } from '@/lib/validations/patient';
import type { ServiceAreaRecord } from '@/lib/patient/service-area';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { TabsContent } from '@/components/ui/tabs';
import { queryErrorMessage } from './patient-form-options';

export type FacilityOption = { id: string; name: string; address: string | null };
export type FacilityUnitOption = {
  id: string;
  name: string;
  floor: string | null;
  unit_type: string | null;
};
export type ServiceAreaOption = ServiceAreaRecord & {
  site: { id: string; name: string } | null;
};
type QueryState<T> = {
  data?: T;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => unknown;
};
export type CareTeamField = {
  name: Extract<
    FieldPath<CreatePatientInput>,
    'primary_pharmacist_id' | 'backup_pharmacist_id' | 'primary_staff_id' | 'backup_staff_id'
  >;
  label: string;
  options: Array<{ id: string; name: string }>;
  isLoading: boolean;
  loadFailed: boolean;
  loadingPlaceholder: string;
  failedPlaceholder: string;
};

export function PatientFormBasicSection({
  careTeamPharmacistsLoadFailed,
  careTeamPharmacistsQuery,
  careTeamStaffLoadFailed,
  careTeamStaffQuery,
  careTeamFields,
}: {
  careTeamPharmacistsLoadFailed: boolean;
  careTeamPharmacistsQuery: QueryState<Array<{ id: string; name: string }>>;
  careTeamStaffLoadFailed: boolean;
  careTeamStaffQuery: QueryState<Array<{ id: string; name: string }>>;
  careTeamFields: CareTeamField[];
}) {
  const {
    register,
    formState: { errors },
  } = useFormContext<CreatePatientInput>();
  return (
    <TabsContent value="basic" className="mt-2">
      <Card>
        <CardHeader className="py-4">
          <CardTitle className="text-base">基本情報</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {/* 氏名 */}
          <div className="space-y-1.5">
            <Label htmlFor="name">
              氏名{' '}
              <span className="text-destructive" aria-hidden="true">
                *
              </span>
            </Label>
            <Input
              id="name"
              {...register('name')}
              placeholder="山田 太郎"
              aria-invalid={!!errors.name}
              aria-describedby={errors.name ? 'name-error' : undefined}
            />
            {errors.name && (
              <p id="name-error" className="text-xs text-destructive" role="alert">
                {errors.name.message}
              </p>
            )}
          </div>

          {/* フリガナ */}
          <div className="space-y-1.5">
            <Label htmlFor="name_kana">
              フリガナ{' '}
              <span className="text-destructive" aria-hidden="true">
                *
              </span>
            </Label>
            <Input
              id="name_kana"
              {...register('name_kana')}
              placeholder="ヤマダ タロウ"
              aria-invalid={!!errors.name_kana}
              aria-describedby={errors.name_kana ? 'name-kana-error' : undefined}
            />
            {errors.name_kana && (
              <p id="name-kana-error" className="text-xs text-destructive" role="alert">
                {errors.name_kana.message}
              </p>
            )}
          </div>

          {/* 生年月日 + 性別 */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:col-span-2">
            <div className="space-y-1.5">
              <Label htmlFor="birth_date">
                生年月日{' '}
                <span className="text-destructive" aria-hidden="true">
                  *
                </span>
              </Label>
              <Input
                id="birth_date"
                type="date"
                {...register('birth_date')}
                aria-invalid={!!errors.birth_date}
                aria-describedby={errors.birth_date ? 'birth-date-error' : undefined}
              />
              {errors.birth_date && (
                <p id="birth-date-error" className="text-xs text-destructive" role="alert">
                  {errors.birth_date.message}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="gender">
                性別{' '}
                <span className="text-destructive" aria-hidden="true">
                  *
                </span>
              </Label>
              <select
                id="gender"
                {...register('gender')}
                aria-invalid={!!errors.gender}
                aria-describedby={errors.gender ? 'gender-error' : undefined}
                className="min-h-[44px] w-full rounded-lg border sm:h-8 sm:min-h-0 border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50 aria-invalid:border-destructive"
              >
                <option value="">選択してください</option>
                <option value="male">男性</option>
                <option value="female">女性</option>
                <option value="other">その他</option>
              </select>
              {errors.gender && (
                <p id="gender-error" className="text-xs text-destructive" role="alert">
                  {errors.gender.message}
                </p>
              )}
            </div>
          </div>

          {/* 担当チーム（患者単位）。新規登録・編集の双方で主/副 薬剤師・スタッフを
                  org メンバーから割当（任意）。POST/PATCH とも 4id を validate+永続化する。 */}
          <div className="space-y-3 border-t pt-4" data-testid="patient-care-team">
            <p className="text-sm font-medium text-foreground">担当チーム</p>
            <p className="text-xs text-muted-foreground">任意。未設定のままでも登録できます。</p>
            {careTeamPharmacistsLoadFailed ? (
              <p
                className="flex flex-wrap items-center gap-x-2 text-xs text-destructive"
                role="alert"
              >
                <span>
                  {queryErrorMessage(
                    careTeamPharmacistsQuery.error,
                    '薬剤師一覧の取得に失敗しました',
                  )}
                </span>
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  className="h-auto min-h-0 p-0 text-xs"
                  onClick={() => careTeamPharmacistsQuery.refetch()}
                >
                  再試行
                </Button>
              </p>
            ) : null}
            {careTeamStaffLoadFailed ? (
              <p
                className="flex flex-wrap items-center gap-x-2 text-xs text-destructive"
                role="alert"
              >
                <span>
                  {queryErrorMessage(careTeamStaffQuery.error, 'スタッフ一覧の取得に失敗しました')}
                </span>
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  className="h-auto min-h-0 p-0 text-xs"
                  onClick={() => careTeamStaffQuery.refetch()}
                >
                  再試行
                </Button>
              </p>
            ) : null}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {careTeamFields.map((field) => (
                <div key={field.name} className="space-y-1.5">
                  <Label htmlFor={field.name}>{field.label}</Label>
                  <select
                    id={field.name}
                    {...register(field.name)}
                    disabled={field.isLoading || field.loadFailed}
                    className="min-h-[44px] w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50 sm:h-8 sm:min-h-0"
                  >
                    <option value="">
                      {field.isLoading
                        ? field.loadingPlaceholder
                        : field.loadFailed
                          ? field.failedPlaceholder
                          : '未設定'}
                    </option>
                    {field.options.map((member) => (
                      <option key={member.id} value={member.id}>
                        {member.name}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>
    </TabsContent>
  );
}

export function PatientFormContactSection({
  patientId,
  selectedFacilityId,
  facilitiesQuery,
  facilityUnitsQuery,
  facilityUnitsLoadFailed,
  serviceAreasQuery,
  serviceAreasLoadFailed,
  serviceAreaWarning,
  qualificationCheckPending,
  qualificationCheckMessage,
  onQualificationCheck,
  watchedBillingSupportFlag,
}: {
  patientId?: string;
  selectedFacilityId: string;
  facilitiesQuery: QueryState<FacilityOption[]>;
  facilityUnitsQuery: QueryState<FacilityUnitOption[]>;
  facilityUnitsLoadFailed: boolean;
  serviceAreasQuery: QueryState<ServiceAreaOption[]>;
  serviceAreasLoadFailed: boolean;
  serviceAreaWarning: { level: 'covered' | 'warning'; message: string } | null;
  qualificationCheckPending: boolean;
  qualificationCheckMessage: { tone: 'success' | 'warning' | 'error'; text: string } | null;
  onQualificationCheck: () => void;
  watchedBillingSupportFlag: boolean;
}) {
  const { register, setValue } = useFormContext<CreatePatientInput>();
  const handleQualificationCheck = onQualificationCheck;
  return (
    <TabsContent id="patient-form-contact" value="contact" className="mt-2">
      <Card>
        <CardHeader className="py-4">
          <CardTitle className="text-base">連絡先・保険情報</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* 電話番号 */}
          <div className="space-y-1.5">
            <Label htmlFor="phone">電話番号</Label>
            <Input id="phone" type="tel" {...register('phone')} placeholder="090-0000-0000" />
          </div>

          {/* 住所 */}
          <div className="space-y-1.5">
            <Label htmlFor="address">住所</Label>
            <Textarea
              id="address"
              {...register('address')}
              placeholder="東京都新宿区..."
              rows={2}
            />
          </div>

          {serviceAreasLoadFailed ? (
            <p
              className="flex flex-wrap items-center gap-x-2 text-xs text-destructive"
              role="alert"
            >
              <span>
                {queryErrorMessage(serviceAreasQuery.error, '訪問エリア設定の取得に失敗しました')}
              </span>
              <Button
                type="button"
                variant="link"
                size="sm"
                className="h-auto min-h-0 p-0 text-xs"
                onClick={() => serviceAreasQuery.refetch()}
              >
                再試行
              </Button>
            </p>
          ) : serviceAreaWarning ? (
            <Alert
              variant="default"
              className={
                serviceAreaWarning.level === 'covered'
                  ? 'border-state-done/40 bg-state-done/5 text-state-done'
                  : 'border-state-confirm/40 bg-state-confirm/5 text-state-confirm'
              }
            >
              <AlertTriangle
                className={
                  serviceAreaWarning.level === 'covered'
                    ? 'h-4 w-4 text-state-done'
                    : 'h-4 w-4 text-state-confirm'
                }
              />
              <AlertDescription>{serviceAreaWarning.message}</AlertDescription>
            </Alert>
          ) : null}

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="facility_id">施設</Label>
              <select
                id="facility_id"
                {...register('facility_id')}
                className="min-h-[44px] w-full rounded-lg border sm:h-9 sm:min-h-0 border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50"
              >
                <option value="">居宅 / 未設定</option>
                {(facilitiesQuery.data ?? []).map((facility) => (
                  <option key={facility.id} value={facility.id}>
                    {facility.name}
                  </option>
                ))}
              </select>
              {facilitiesQuery.isError ? (
                <p
                  className="flex flex-wrap items-center gap-x-2 text-xs text-destructive"
                  role="alert"
                >
                  <span>
                    {queryErrorMessage(facilitiesQuery.error, '施設一覧の取得に失敗しました')}
                  </span>
                  <Button
                    type="button"
                    variant="link"
                    size="sm"
                    className="h-auto min-h-0 p-0 text-xs"
                    onClick={() => facilitiesQuery.refetch()}
                  >
                    再試行
                  </Button>
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  施設患者の場合は先に施設を選択してください。
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="facility_unit_id">ユニット</Label>
              <select
                id="facility_unit_id"
                {...register('facility_unit_id')}
                disabled={
                  !selectedFacilityId || facilityUnitsQuery.isLoading || facilityUnitsLoadFailed
                }
                className="min-h-[44px] w-full rounded-lg border sm:h-9 sm:min-h-0 border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <option value="">
                  {!selectedFacilityId
                    ? '施設を選択してください'
                    : facilityUnitsQuery.isLoading
                      ? 'ユニットを読み込み中...'
                      : facilityUnitsLoadFailed
                        ? 'ユニット一覧を取得できません'
                        : 'ユニットを選択してください'}
                </option>
                {(facilityUnitsQuery.data ?? []).map((unit) => (
                  <option key={unit.id} value={unit.id}>
                    {[unit.floor, unit.name].filter(Boolean).join(' / ')}
                  </option>
                ))}
              </select>
              {facilityUnitsLoadFailed ? (
                <p
                  className="flex flex-wrap items-center gap-x-2 text-xs text-destructive"
                  role="alert"
                >
                  <span>
                    {queryErrorMessage(
                      facilityUnitsQuery.error,
                      'ユニット一覧の取得に失敗しました',
                    )}
                  </span>
                  <Button
                    type="button"
                    variant="link"
                    size="sm"
                    className="h-auto min-h-0 p-0 text-xs"
                    onClick={() => facilityUnitsQuery.refetch()}
                  >
                    再試行
                  </Button>
                </p>
              ) : (
                selectedFacilityId &&
                !facilityUnitsQuery.isLoading &&
                (facilityUnitsQuery.data?.length ?? 0) === 0 && (
                  <p className="text-xs text-state-confirm" role="status">
                    この施設には登録済みユニットがありません。施設管理から先にユニットを追加してください。
                  </p>
                )
              )}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="unit_name">居室・部屋番号</Label>
            <Input
              id="unit_name"
              {...register('unit_name')}
              placeholder={
                selectedFacilityId ? '203号室 / 東棟3F など' : '居宅なら未入力で構いません'
              }
            />
          </div>

          {/* 医療保険番号 */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="medical_insurance_number">医療保険番号</Label>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  id="medical_insurance_number"
                  {...register('medical_insurance_number')}
                  placeholder="12345678"
                  className="flex-1"
                />
                {patientId ? (
                  <Button
                    type="button"
                    variant="outline"
                    className="min-h-11 shrink-0"
                    onClick={handleQualificationCheck}
                    disabled={qualificationCheckPending}
                  >
                    <ShieldCheck className="mr-2 h-4 w-4" aria-hidden="true" />
                    {qualificationCheckPending ? '確認中...' : '資格確認'}
                  </Button>
                ) : null}
              </div>
              {qualificationCheckMessage ? (
                <p
                  role={qualificationCheckMessage.tone === 'error' ? 'alert' : 'status'}
                  aria-live={qualificationCheckMessage.tone === 'error' ? 'assertive' : 'polite'}
                  className={
                    qualificationCheckMessage.tone === 'success'
                      ? 'text-xs text-state-done'
                      : qualificationCheckMessage.tone === 'warning'
                        ? 'text-xs text-state-confirm'
                        : 'text-xs text-destructive'
                  }
                >
                  {qualificationCheckMessage.text}
                </p>
              ) : null}
            </div>

            {/* 介護保険番号 */}
            <div className="space-y-1.5">
              <Label htmlFor="care_insurance_number">介護保険番号</Label>
              <Input
                id="care_insurance_number"
                {...register('care_insurance_number')}
                placeholder="1234567890"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="billing_support_flag">請求支援フラグ</Label>
            <label className="flex min-h-10 items-center gap-3 rounded-lg border border-border/70 px-3 py-2 text-sm">
              <Checkbox
                id="billing_support_flag"
                checked={watchedBillingSupportFlag}
                onCheckedChange={(checked) =>
                  setValue('billing_support_flag', checked === true, { shouldDirty: true })
                }
              />
              <span>請求支援が必要な患者として登録する</span>
            </label>
          </div>
        </CardContent>
      </Card>
    </TabsContent>
  );
}
