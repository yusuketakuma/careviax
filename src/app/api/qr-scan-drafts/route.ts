import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { withOrgContext } from '@/lib/db/rls';
import { success, validationError } from '@/lib/api/response';
import { parsePaginationParams } from '@/lib/api/pagination';
import { prisma } from '@/lib/db/client';
import { getRealtimeAdapter } from '@/server/adapters/realtime';
import { Prisma } from '@prisma/client';
import {
  isJahisQR,
  parseJahisQRSafe,
  mergeJahisQRPages,
  detectMultiQR,
} from '@/lib/pharmacy/jahis-qr';
import type { JahisQRData } from '@/lib/pharmacy/jahis-qr';
import { mapJahisToIntake } from '@/lib/pharmacy/qr-intake-mapper';
import { replaceJahisSupplementalRecords } from '@/server/services/jahis-supplemental-records';
import { z } from 'zod';
import { addDays, subDays, parseISO } from 'date-fns';

// ── Validation schema ──

const MAX_QR_TEXT_COUNT = 16;
const MAX_QR_TEXT_LENGTH = 8192;

const createQrDraftSchema = z.object({
  qr_texts: z.array(z.string().min(1).max(MAX_QR_TEXT_LENGTH)).min(1).max(MAX_QR_TEXT_COUNT),
  patient_id: z.string().optional(),
  site_id: z.string().min(1),
  session_id: z.string().optional(),
});

function buildDraftParsedData(args: {
  qrData: JahisQRData;
  mapResult: Awaited<ReturnType<typeof mapJahisToIntake>> | null;
}) {
  const mapResult = args.mapResult;

  return {
    patient: args.qrData.patient,
    medications: args.qrData.medications,
    prescribingInstitution: args.qrData.prescribingInstitution,
    dispensingInstitution: args.qrData.dispensingInstitution,
    remarks: args.qrData.remarks,
    patientNotes: args.qrData.patientNotes,
    supplementalRecords: args.qrData.supplementalRecords ?? [],
    splitInfo: args.qrData.splitInfo ?? null,
    rawText: args.qrData.rawText,
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

export const GET = withAuth(
  async (req: AuthenticatedRequest) => {
    const { searchParams } = new URL(req.url);
    const { cursor, limit } = parsePaginationParams(searchParams);
    const unmatched = searchParams.get('unmatched') === 'true';

    const drafts = await prisma.qrScanDraft.findMany({
      where: {
        org_id: req.orgId,
        status: 'pending',
        ...(unmatched ? { patient_id: null } : {}),
      },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
    });

    const hasMore = drafts.length > limit;
    const data = hasMore ? drafts.slice(0, limit) : drafts;
    const nextCursor = hasMore ? data[data.length - 1]?.id : undefined;

    return success({ data, hasMore, nextCursor });
  },
  {
    permission: 'canVisit',
    message: 'QRスキャン下書きの閲覧権限がありません',
  },
);

// ── POST: create a new QR draft ──

export const POST = withAuth(
  async (req: AuthenticatedRequest) => {
    const body = await req.json().catch(() => null);
    if (!body) return validationError('リクエストボディが不正です');

    const parsed = createQrDraftSchema.safeParse(body);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    const { qr_texts, patient_id, site_id, session_id: clientSessionId } = parsed.data;

    if (patient_id) {
      const patient = await prisma.patient.findFirst({
        where: { id: patient_id, org_id: req.orgId },
        select: { id: true },
      });
      if (!patient) {
        return validationError('指定された患者が見つかりません', {
          patient_id: ['指定された患者が見つかりません'],
        });
      }
    }

    const site = await prisma.pharmacySite.findFirst({
      where: { id: site_id, org_id: req.orgId },
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

    // Merge pages if multiple QR texts
    const mergedData: JahisQRData =
      successfulPages.length === 1 ? successfulPages[0] : mergeJahisQRPages(successfulPages);

    // Detect multi-QR info from the first QR text (record 911 may appear anywhere in the text)
    const multiQrInfo = detectMultiQR(qr_texts[0]);
    const expected_qr_count = multiQrInfo?.splitCount ?? null;

    let autoCompleted: unknown = null;
    let draftParsedData = buildDraftParsedData({ qrData: mergedData, mapResult: null });
    try {
      const mapResult = await mapJahisToIntake(mergedData, {
        orgId: req.orgId,
        siteId: site_id,
        patientId: patient_id ?? '',
        caseId: '',
        scannedBy: req.userId,
      });
      autoCompleted = mapResult.autoCompletedFields;
      draftParsedData = buildDraftParsedData({ qrData: mergedData, mapResult });
    } catch {
      // Mapper failure is non-fatal; continue with raw parsed data only
    }

    // Duplicate detection: look for an existing pending draft for the same patient
    // with a prescribed_date within ±1 day
    let duplicate_draft_id: string | undefined;
    if (patient_id && mergedData.dispensingDate) {
      try {
        const prescribedDate = parseISO(mergedData.dispensingDate);
        const windowStart = subDays(prescribedDate, 1);
        const windowEnd = addDays(prescribedDate, 1);

        const existingDraft = await prisma.qrScanDraft.findFirst({
          where: {
            org_id: req.orgId,
            patient_id,
            status: 'pending',
            created_at: {
              gte: windowStart,
              lte: windowEnd,
            },
          },
          select: { id: true },
          orderBy: { created_at: 'desc' },
        });

        if (existingDraft) {
          duplicate_draft_id = existingDraft.id;
        }
      } catch {
        // Duplicate detection is best-effort; skip on error
      }
    }

    // Create QrScanDraft record
    const draft = await withOrgContext(req.orgId, async (tx) => {
      const created = await tx.qrScanDraft.create({
        data: {
          org_id: req.orgId,
          site_id,
          patient_id: patient_id ?? null,
          scanned_by: req.userId,
          session_id,
          status: 'pending',
          schema_version: 1,
          raw_qr_texts: qr_texts,
          parsed_data: draftParsedData as never,
          parse_errors: allErrors.length > 0 ? (allErrors as never) : Prisma.JsonNull,
          auto_completed: autoCompleted as never,
          expected_qr_count,
        },
      });

      await replaceJahisSupplementalRecords(tx, {
        orgId: req.orgId,
        patientId: patient_id ?? null,
        qrDraftId: created.id,
        records: mergedData.supplementalRecords,
      });

      return created;
    });

    // Emit SSE event (best-effort)
    try {
      const adapter = getRealtimeAdapter();
      adapter.broadcastStatusUpdate(`org:${req.orgId}:qr-drafts`, {
        type: 'qr_draft_created',
        payload: { draftId: draft.id, sessionId: session_id, patientId: patient_id ?? null },
      });
    } catch {
      // Realtime broadcast is best-effort
    }

    return success(
      {
        draft,
        parse_result: {
          success: allErrors.length === 0,
          warnings: allWarnings,
          errors: allErrors,
        },
        ...(duplicate_draft_id ? { duplicate_draft_id } : {}),
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
