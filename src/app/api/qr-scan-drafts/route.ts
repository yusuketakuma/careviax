import { NextRequest } from 'next/server';
import { withAuthContext } from '@/lib/auth/context';
import { withOrgContext } from '@/lib/db/rls';
import { toPrismaJsonInput } from '@/lib/db/json';
import { success, validationError, conflict, internalError } from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { parsePaginationParams } from '@/lib/api/pagination';
import { prisma } from '@/lib/db/client';
import { isPrismaUniqueConstraintError } from '@/lib/db/prisma-errors';
import { broadcastOrgRealtimeEvent } from '@/server/services/org-realtime';
import { Prisma } from '@prisma/client';
import {
  isJahisQR,
  parseJahisQRSafe,
  mergeJahisQRPages,
  detectMultiQR,
} from '@/lib/pharmacy/jahis-qr';
import {
  assessQrPatientIdentity,
  collectMissingQrPatientIdentityFields,
} from '@/lib/pharmacy/qr-patient-match';
import { buildQrPayloadHash } from '@/lib/pharmacy/qr-draft-fingerprint';
import type { JahisQRData } from '@/lib/pharmacy/jahis-qr';
import { mapJahisToIntake } from '@/lib/pharmacy/qr-intake-mapper';
import { replaceJahisSupplementalRecords } from '@/server/services/jahis-supplemental-records';
import { z } from 'zod';
import {
  buildQrDraftAssignmentWhere,
  canAccessPrescriptionPatient,
  getAssignedPatientIds,
} from '@/server/services/prescription-access';

// ── Validation schema ──

const MAX_QR_TEXT_COUNT = 16;
const MAX_QR_TEXT_LENGTH = 8192;

const optionalTrimmedStringSchema = z.string().trim().min(1).optional();

const createQrDraftSchema = z.object({
  qr_texts: z.array(z.string().trim().min(1).max(MAX_QR_TEXT_LENGTH)).min(1).max(MAX_QR_TEXT_COUNT),
  patient_id: optionalTrimmedStringSchema,
  site_id: z.string().trim().min(1),
  session_id: optionalTrimmedStringSchema,
});

type QrDraftResponse = {
  raw_qr_texts?: unknown;
  qr_payload_hash?: unknown;
  parsed_data?: unknown;
  [key: string]: unknown;
};

function sanitizeParsedDataForResponse(parsedData: unknown): unknown {
  if (Array.isArray(parsedData)) return parsedData.map(sanitizeParsedDataForResponse);
  if (!parsedData || typeof parsedData !== 'object') return parsedData;

  return Object.fromEntries(
    Object.entries(parsedData as Record<string, unknown>)
      .filter(([key]) => !['rawText', 'rawLine', 'raw_qr_texts', 'qr_payload_hash'].includes(key))
      .map(([key, value]) => [key, sanitizeParsedDataForResponse(value)]),
  );
}

function toQrDraftResponse<T extends QrDraftResponse>(draft: T) {
  const sanitized = { ...draft };
  delete sanitized.raw_qr_texts;
  delete sanitized.qr_payload_hash;
  return {
    ...sanitized,
    parsed_data: sanitizeParsedDataForResponse(draft.parsed_data),
  };
}

function readQrFormatFamily(qrData: JahisQRData) {
  const header = qrData.rawText.split(/\r?\n/, 1)[0]?.trim() ?? '';
  if (header.startsWith('JAHISTC')) return 'e_okusuri';
  if (/^JAHIS\d{1,2}$/.test(header)) return 'outpatient_prescription';
  return 'unknown';
}

function validateQrPageSet(pages: JahisQRData[]) {
  if (pages.length === 0) return null;

  const families = new Set(pages.map(readQrFormatFamily));
  if (families.size > 1) {
    return '異なるJAHIS QR形式が混在しています。同じ処方/お薬手帳のQRだけを読み取ってください';
  }

  const firstIdentity = pages[0].patient;
  const identityMismatch = pages.some((page) => {
    return (
      (page.patient.name || '') !== (firstIdentity.name || '') ||
      (page.patient.birthDate || '') !== (firstIdentity.birthDate || '') ||
      (page.patient.gender || '') !== (firstIdentity.gender || '')
    );
  });
  if (identityMismatch) {
    return '分割QR内の患者情報が一致しません。同じ患者のQRだけを読み取ってください';
  }

  const splitPages = pages.filter((page) => page.splitInfo);
  if (splitPages.length === 0) return null;
  if (splitPages.length !== pages.length) {
    return '分割QRと通常QRが混在しています。分割QRは全ページを読み取ってください';
  }

  const firstSplit = splitPages[0].splitInfo;
  if (!firstSplit) return null;
  if (firstSplit.splitCount !== pages.length) {
    return `分割QRの枚数が不足しています。${firstSplit.splitCount}枚中${pages.length}枚です`;
  }

  const sequences = new Set<number>();
  for (const page of splitPages) {
    const splitInfo = page.splitInfo;
    if (!splitInfo) continue;
    if (splitInfo.dataId !== firstSplit.dataId || splitInfo.splitCount !== firstSplit.splitCount) {
      return '分割QRの識別子または総枚数が一致しません。同じ処方/お薬手帳のQRだけを読み取ってください';
    }
    if (sequences.has(splitInfo.sequenceNumber)) {
      return `分割QRの${splitInfo.sequenceNumber}枚目が重複しています`;
    }
    sequences.add(splitInfo.sequenceNumber);
  }

  for (let sequenceNumber = 1; sequenceNumber <= firstSplit.splitCount; sequenceNumber += 1) {
    if (!sequences.has(sequenceNumber)) {
      return `分割QRの${sequenceNumber}枚目が不足しています`;
    }
  }

  return null;
}

function buildDraftParsedData(args: {
  qrData: JahisQRData;
  mapResult: Awaited<ReturnType<typeof mapJahisToIntake>> | null;
  parseWarnings?: unknown[];
}) {
  const mapResult = args.mapResult;

  return {
    patient: args.qrData.patient,
    medications: args.qrData.medications,
    prescribingInstitution: args.qrData.prescribingInstitution,
    dispensingInstitution: args.qrData.dispensingInstitution,
    prescriptionIssueDate: args.qrData.prescriptionIssueDate ?? null,
    prescriptionExpirationDate: args.qrData.prescriptionExpirationDate ?? null,
    prescriptionInsurance: args.qrData.prescriptionInsurance ?? null,
    rawRecords: args.qrData.rawRecords ?? [],
    parseWarnings: args.parseWarnings ?? [],
    remarks: args.qrData.remarks,
    patientNotes: args.qrData.patientNotes,
    supplementalRecords: args.qrData.supplementalRecords ?? [],
    splitInfo: args.qrData.splitInfo ?? null,
    patientName: args.qrData.patient.name,
    patientNameKana: args.qrData.patient.nameKana ?? '',
    patientBirthdate: args.qrData.patient.birthDate ?? '',
    patientGender: args.qrData.patient.gender ?? '',
    prescriptionDate: mapResult?.prescribedDate ?? args.qrData.dispensingDate ?? '',
    prescriberName: mapResult?.prescriberName ?? args.qrData.prescribingDoctor ?? '',
    prescriberInstitution:
      mapResult?.prescriberInstitution ?? args.qrData.prescribingInstitution.name ?? '',
    prescriberInstitutionCode:
      mapResult?.prescriberInstitutionCode ??
      args.qrData.prescribingInstitution.institutionCode ??
      '',
    prescriberInstitutionId: mapResult?.prescriberInstitutionId ?? null,
    isNewInstitution: mapResult?.isNewInstitution ?? false,
    lines:
      mapResult?.lines.map((line) => ({
        drugName: line.drug_name,
        drugCode: line.drug_code,
        sourceDrugCode: line.source_drug_code ?? null,
        sourceDrugCodeType: line.source_drug_code_type ?? null,
        drugCodeResolutionStatus: line.drug_code_resolution_status ?? null,
        drugCodeResolutionSource: line.drug_code_resolution_source ?? null,
        candidateDrugMasterId: line.candidate_drug_master_id ?? null,
        candidateDrugCode: line.candidate_drug_code ?? null,
        candidateDrugName: line.candidate_drug_name ?? null,
        dosageForm: line.dosage_form,
        dose: line.dose,
        frequency: line.frequency,
        days: line.days,
        quantity: line.quantity,
        unit: line.unit,
        isGeneric: line.is_generic,
        packagingMethod: line.packaging_method,
        packagingInstructions: line.packaging_instructions,
        packagingInstructionTags: line.packaging_instruction_tags,
        route: line.route,
        dispensingMethod: line.dispensing_method,
        startDate: line.start_date,
        endDate: line.end_date,
        notes: line.notes,
      })) ?? [],
    unmatchedDrugs: mapResult?.unmatchedDrugs ?? [],
    formularyStatus: mapResult?.formularyStatus ?? [],
  };
}

// ── GET: list pending drafts (paginated) ──

const authenticatedGET = withAuthContext(
  async (req, ctx) => {
    const { searchParams } = new URL(req.url);
    const { cursor, limit } = parsePaginationParams(searchParams);
    const unmatched = searchParams.get('unmatched') === 'true';
    const includeUnmatchedCount = searchParams.get('include_unmatched_count') === '1';
    const assignedPatientIds = await getAssignedPatientIds(prisma, ctx.orgId, ctx);
    const assignmentWhere = buildQrDraftAssignmentWhere(ctx, assignedPatientIds ?? []);

    const baseWhere = {
      org_id: ctx.orgId,
      status: 'pending' as const,
      ...(assignmentWhere ? { AND: [assignmentWhere] } : {}),
    };
    const listWhere = {
      ...baseWhere,
      ...(unmatched ? { patient_id: null } : {}),
    };

    const { drafts, unmatchedCount } = await withOrgContext(ctx.orgId, async (tx) => {
      const [drafts, unmatchedCount] = await Promise.all([
        tx.qrScanDraft.findMany({
          where: listWhere,
          take: limit + 1,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
          orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
        }),
        includeUnmatchedCount
          ? tx.qrScanDraft.count({
              where: {
                ...baseWhere,
                patient_id: null,
              },
            })
          : Promise.resolve(undefined),
      ]);

      return {
        drafts,
        unmatchedCount,
      };
    });

    const hasMore = drafts.length > limit;
    const data = (hasMore ? drafts.slice(0, limit) : drafts).map(toQrDraftResponse);
    const nextCursor = hasMore ? data[data.length - 1]?.id : undefined;

    return success({ data, hasMore, nextCursor, unmatchedCount });
  },
  {
    permission: 'canVisit',
    message: 'QRスキャン下書きの閲覧権限がありません',
  },
);

export async function GET(
  req: NextRequest,
  routeContext: { params: Promise<Record<string, string>> },
) {
  try {
    return withSensitiveNoStore(await authenticatedGET(req, routeContext));
  } catch {
    return withSensitiveNoStore(internalError());
  }
}

// ── POST: create a new QR draft ──

const authenticatedPOST = withAuthContext(
  async (req, ctx) => {
    const payload = await readJsonObjectRequestBody(req);
    if (!payload) return validationError('リクエストボディが不正です');

    const parsed = createQrDraftSchema.safeParse(payload);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    const {
      qr_texts: parsedQrTexts,
      patient_id,
      site_id,
      session_id: clientSessionId,
    } = parsed.data;
    const uniqueQrTexts = Array.from(new Set(parsedQrTexts));
    if (uniqueQrTexts.length !== parsedQrTexts.length) {
      return validationError('同じQRコードが重複しています', {
        qr_texts: ['同じQRコードを複数回読み取っています'],
      });
    }
    const qr_texts = uniqueQrTexts;
    const qrPayloadHash = buildQrPayloadHash(qr_texts);
    let selectedPatient: {
      id: string;
      name: string;
      name_kana: string | null;
      birth_date: Date;
      gender: string;
    } | null = null;

    if (patient_id) {
      if (!(await canAccessPrescriptionPatient(prisma, ctx.orgId, ctx, patient_id))) {
        return validationError('この患者のQRスキャン下書きを作成する権限がありません');
      }
      const patient = await prisma.patient.findFirst({
        where: { id: patient_id, org_id: ctx.orgId },
        select: { id: true, name: true, name_kana: true, birth_date: true, gender: true },
      });
      if (!patient) {
        return validationError('指定された患者が見つかりません', {
          patient_id: ['指定された患者が見つかりません'],
        });
      }
      selectedPatient = patient;
    }

    const site = await prisma.pharmacySite.findFirst({
      where: { id: site_id, org_id: ctx.orgId },
      select: { id: true },
    });
    if (!site) {
      return validationError('指定された店舗が見つかりません', {
        site_id: ['指定された店舗が見つかりません'],
      });
    }

    // Validate each QR text is a JAHIS QR code
    const invalidIndexes = qr_texts
      .map((t, i) => (!isJahisQR(t) ? i : null))
      .filter((i): i is number => i !== null);

    if (invalidIndexes.length > 0) {
      return validationError('JAHIS形式でないQRコードが含まれています', {
        invalid_indexes: invalidIndexes,
      });
    }

    // Server-generated session_id if not provided by client
    const session_id = clientSessionId ?? crypto.randomUUID();

    // Parse each QR text
    const parseResults = qr_texts.map((t) => parseJahisQRSafe(t));

    // Collect all errors and warnings across pages
    const allErrors = parseResults.flatMap((r) => ('errors' in r ? r.errors : []));
    const allWarnings = parseResults.flatMap((r) => r.warnings);

    // Extract successful data (partial data from failed parses is still usable)
    const successfulPages = parseResults.map((r) => r.data as JahisQRData);

    const pageSetError = validateQrPageSet(successfulPages);
    if (pageSetError) {
      return validationError(pageSetError, {
        qr_texts: [pageSetError],
      });
    }

    // Merge pages if multiple QR texts
    const mergedData: JahisQRData =
      successfulPages.length === 1 ? successfulPages[0] : mergeJahisQRPages(successfulPages);

    const qrPatientIdentity = {
      name: mergedData.patient.name,
      nameKana: mergedData.patient.nameKana,
      birthDate: mergedData.patient.birthDate,
      gender: mergedData.patient.gender,
    };
    const missingIdentity = collectMissingQrPatientIdentityFields(qrPatientIdentity);
    if (missingIdentity.length > 0) {
      return validationError('QRコードの患者情報を確認できません', {
        patient_id: ['QRコードの患者名と生年月日を確認できません'],
        missing_identity: missingIdentity,
      });
    }

    if (selectedPatient) {
      const identityAssessment = assessQrPatientIdentity(qrPatientIdentity, selectedPatient);
      if (identityAssessment.kind === 'unverifiable') {
        return validationError('QRコードの患者情報を確認できません', {
          patient_id: ['QRコードの患者名と生年月日を確認できません'],
          missing_identity: identityAssessment.missing,
        });
      }
      if (identityAssessment.kind === 'mismatch') {
        return validationError('QRコードの患者情報が選択患者と一致しません', {
          patient_id: ['QRコードの患者情報が選択患者と一致しません'],
          mismatches: identityAssessment.mismatches,
        });
      }
    }

    // Detect multi-QR info from the first QR text (record 911 may appear anywhere in the text)
    const multiQrInfo = detectMultiQR(qr_texts[0]);
    const expected_qr_count = multiQrInfo?.splitCount ?? null;

    let autoCompleted: unknown = null;
    let draftParsedData = buildDraftParsedData({
      qrData: mergedData,
      mapResult: null,
      parseWarnings: allWarnings,
    });
    try {
      const mapResult = await mapJahisToIntake(mergedData, {
        orgId: ctx.orgId,
        siteId: site_id,
        patientId: patient_id ?? '',
        caseId: '',
        scannedBy: ctx.userId,
      });
      autoCompleted = mapResult.autoCompletedFields;
      draftParsedData = buildDraftParsedData({
        qrData: mergedData,
        mapResult,
        parseWarnings: allWarnings,
      });
    } catch {
      // Mapper failure is non-fatal; continue with raw parsed data only
    }

    try {
      const assignedPatientIds = await getAssignedPatientIds(prisma, ctx.orgId, ctx);
      const duplicateAssignmentWhere = buildQrDraftAssignmentWhere(ctx, assignedPatientIds ?? []);
      const duplicateWhere: Prisma.QrScanDraftWhereInput = {
        org_id: ctx.orgId,
        status: { in: ['pending', 'confirmed'] },
        qr_payload_hash: qrPayloadHash,
      };
      const existingDraft = await prisma.qrScanDraft.findFirst({
        where: {
          ...duplicateWhere,
          ...(duplicateAssignmentWhere ? { AND: [duplicateAssignmentWhere] } : {}),
        },
        select: { id: true, status: true },
        orderBy: { created_at: 'desc' },
      });

      if (existingDraft) {
        return conflict('同じQRスキャン下書きが既に存在します', {
          duplicate_draft_id: existingDraft.id,
          status: existingDraft.status,
        });
      }

      const inaccessibleDuplicate = duplicateAssignmentWhere
        ? await prisma.qrScanDraft.findFirst({
            where: duplicateWhere,
            select: { id: true },
            orderBy: { created_at: 'desc' },
          })
        : null;

      if (inaccessibleDuplicate) {
        return conflict('同じQRスキャン下書きが既に存在します');
      }
    } catch {
      return conflict('QRスキャン下書きの重複確認に失敗しました');
    }

    const sanitizedDraftParsedData = sanitizeParsedDataForResponse(draftParsedData);

    // Create QrScanDraft record
    let draft;
    try {
      draft = await withOrgContext(ctx.orgId, async (tx) => {
        const created = await tx.qrScanDraft.create({
          data: {
            org_id: ctx.orgId,
            site_id,
            patient_id: patient_id ?? null,
            scanned_by: ctx.userId,
            session_id,
            status: 'pending',
            schema_version: 1,
            raw_qr_texts: qr_texts,
            qr_payload_hash: qrPayloadHash,
            parsed_data: toPrismaJsonInput(sanitizedDraftParsedData),
            parse_errors: allErrors.length > 0 ? toPrismaJsonInput(allErrors) : Prisma.JsonNull,
            auto_completed: toPrismaJsonInput(autoCompleted),
            expected_qr_count,
          },
        });

        await replaceJahisSupplementalRecords(tx, {
          orgId: ctx.orgId,
          patientId: patient_id ?? null,
          qrDraftId: created.id,
          records: mergedData.supplementalRecords,
        });

        return created;
      });
    } catch (error) {
      if (isPrismaUniqueConstraintError(error)) {
        return conflict('同じQRスキャン下書きが既に存在します');
      }
      throw error;
    }

    // Emit SSE event (best-effort)
    await broadcastOrgRealtimeEvent({
      orgId: ctx.orgId,
      type: 'qr_draft_created',
    });

    return success(
      {
        draft: toQrDraftResponse(draft),
        parse_result: {
          success: allErrors.length === 0,
          warnings: allWarnings,
          errors: allErrors,
        },
        session_id,
      },
      201,
    );
  },
  {
    permission: 'canVisit',
    message: 'QRスキャン下書きの作成権限がありません',
  },
);

export async function POST(
  req: NextRequest,
  routeContext: { params: Promise<Record<string, string>> },
) {
  try {
    return withSensitiveNoStore(await authenticatedPOST(req, routeContext));
  } catch {
    return withSensitiveNoStore(internalError());
  }
}
