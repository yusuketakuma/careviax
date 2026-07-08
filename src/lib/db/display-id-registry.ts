export const DISPLAY_ID_GLOBAL_ORG_ID = '__global__';
export const DISPLAY_ID_EXCLUDED_MODELS = ['Setting'] as const;
export const DISPLAY_ID_INFRASTRUCTURE_MODELS = ['IdSequence'] as const;
export const RESERVED_DISPLAY_ID_PREFIXES = ['cfg'] as const;

export type DisplayIdScope = 'org' | 'global' | 'orgViaParent';

export interface DisplayIdRegistryEntry {
  readonly prefix: string;
  readonly scope: DisplayIdScope;
  readonly parent?: 'HandoffBoard';
}

export const DISPLAY_ID_REGISTRY = {
  AuditLog: { prefix: 'l', scope: 'org' },
  AuditLogReview: { prefix: 'alr', scope: 'org' },
  BillingCandidate: { prefix: 'b', scope: 'org' },
  BillingEvidence: { prefix: 'bev', scope: 'org' },
  BillingRule: { prefix: 'brul', scope: 'org' },
  // Platform control-plane rows are platform-only global identifiers; target_org_id is not row ownership.
  BreakGlassSession: { prefix: 'bg', scope: 'global' },
  BusinessHoliday: { prefix: 'bhol', scope: 'org' },
  CareCase: { prefix: 'cc', scope: 'org' },
  CareReport: { prefix: 'c', scope: 'org' },
  CareReportRevision: { prefix: 'crev', scope: 'org' },
  CareReportSendRequest: { prefix: 'crsr', scope: 'org' },
  CareTeamLink: { prefix: 'ctl', scope: 'org' },
  ClaimCooperationNote: { prefix: 'ccn', scope: 'org' },
  CommunicationEvent: { prefix: 'cev', scope: 'org' },
  CommunicationRequest: { prefix: 'creq', scope: 'org' },
  CommunicationResponse: { prefix: 'cres', scope: 'org' },
  CommunityActivity: { prefix: 'cact', scope: 'org' },
  ConferenceNote: { prefix: 'cnf', scope: 'org' },
  ConsentRecord: { prefix: 'cons', scope: 'org' },
  ContactParty: { prefix: 'cp', scope: 'org' },
  ContractDocument: { prefix: 'cdoc', scope: 'org' },
  CycleHold: { prefix: 'chld', scope: 'org' },
  CycleTransitionLog: { prefix: 'ctlog', scope: 'org' },
  DeliveryRecord: { prefix: 'dlv', scope: 'org' },
  DispenseAudit: { prefix: 'dpa', scope: 'org' },
  DispenseResult: { prefix: 'dpr', scope: 'org' },
  DispenseTask: { prefix: 'd', scope: 'org' },
  DispensingDecision: { prefix: 'dpd', scope: 'org' },
  DocumentDeliveryRule: { prefix: 'ddr', scope: 'org' },
  // Nullable org_id hybrid; schema/backfill wave is deferred until tenant-vs-global semantics are explicit.
  DrugAlertRule: { prefix: 'dar', scope: 'org' },
  DrugInteraction: { prefix: 'dint', scope: 'global' },
  DrugMaster: { prefix: 'drug', scope: 'global' },
  DrugMasterChangeEvent: { prefix: 'dmce', scope: 'global' },
  DrugMasterImportLog: { prefix: 'dmil', scope: 'global' },
  DrugPackage: { prefix: 'dpkg', scope: 'global' },
  DrugPackageInsert: { prefix: 'dpki', scope: 'global' },
  DrugPriceVersion: { prefix: 'dpv', scope: 'global' },
  EscalationRule: { prefix: 'esc', scope: 'org' },
  ExternalAccessGrant: { prefix: 'e', scope: 'org' },
  ExternalMedicationStockObservation: { prefix: 'emso', scope: 'org' },
  ExternalProfessional: { prefix: 'extp', scope: 'org' },
  Facility: { prefix: 'fac', scope: 'org' },
  FacilityContact: { prefix: 'facc', scope: 'org' },
  FacilityStandardRegistration: { prefix: 'fsr', scope: 'org' },
  FacilityUnit: { prefix: 'facu', scope: 'org' },
  FacilityVisitBatch: { prefix: 'fvb', scope: 'org' },
  FileAsset: { prefix: 'f', scope: 'org' },
  FirstVisitDocument: { prefix: 'fvd', scope: 'org' },
  FormularyChangeRequest: { prefix: 'fcr', scope: 'org' },
  FormularyTemplate: { prefix: 'ftpl', scope: 'org' },
  GenericDrugMapping: { prefix: 'gdm', scope: 'global' },
  HandoffBoard: { prefix: 'hb', scope: 'org' },
  HandoffItem: { prefix: 'h', scope: 'orgViaParent', parent: 'HandoffBoard' },
  IncidentReport: { prefix: 'x', scope: 'org' },
  InboundCommunicationAttachment: { prefix: 'icatt', scope: 'org' },
  InboundCommunicationEvent: { prefix: 'icev', scope: 'org' },
  InboundCommunicationSignal: { prefix: 'icsig', scope: 'org' },
  InboundSourceMapping: { prefix: 'ismap', scope: 'org' },
  InquiryRecord: { prefix: 'i', scope: 'org' },
  // Nullable org_id job rows can represent global work; schema/backfill wave is permanently deferred.
  IntegrationJob: { prefix: 'ijob', scope: 'org' },
  Intervention: { prefix: 'itv', scope: 'org' },
  JahisSupplementalRecord: { prefix: 'jsr', scope: 'org' },
  LabelDictionary: { prefix: 'lbl', scope: 'global' },
  ManagementPlan: { prefix: 'mgp', scope: 'org' },
  MedicationCycle: { prefix: 'mcyc', scope: 'org' },
  MedicationIssue: { prefix: 'miss', scope: 'org' },
  MedicationProfile: { prefix: 'm', scope: 'org' },
  MedicationStockEvent: { prefix: 'msev', scope: 'org' },
  MedicationStockObservationContext: { prefix: 'msoc', scope: 'org' },
  MedicationStockSnapshot: { prefix: 'mss', scope: 'org' },
  Membership: { prefix: 'mem', scope: 'org' },
  Notification: { prefix: 'n', scope: 'org' },
  NotificationRule: { prefix: 'nrul', scope: 'org' },
  Organization: { prefix: 'o', scope: 'global' },
  PackagingGroup: { prefix: 'pkg', scope: 'org' },
  PackagingMethodMaster: { prefix: 'pmm', scope: 'org' },
  PartnerPharmacy: { prefix: 'ppha', scope: 'org' },
  PartnerVisitRecord: { prefix: 'pvr', scope: 'org' },
  Patient: { prefix: 'p', scope: 'org' },
  PatientCondition: { prefix: 'pcnd', scope: 'org' },
  PatientFieldRevision: { prefix: 'pfr', scope: 'org' },
  PatientInsurance: { prefix: 'pins', scope: 'org' },
  PatientLabObservation: { prefix: 'plab', scope: 'org' },
  PatientLink: { prefix: 'plnk', scope: 'org' },
  PatientMcsLink: { prefix: 'pml', scope: 'org' },
  PatientMcsMessage: { prefix: 'pmmsg', scope: 'org' },
  PatientMcsSummary: { prefix: 'pmsum', scope: 'org' },
  PatientMedicalProcedure: { prefix: 'pmp', scope: 'org' },
  PatientMedicationStockItem: { prefix: 'pmsi', scope: 'org' },
  PatientNarcoticUse: { prefix: 'pnar', scope: 'org' },
  PatientPackagingProfile: { prefix: 'ppp', scope: 'org' },
  PatientSchedulePreference: { prefix: 'psp', scope: 'org' },
  PatientSelfReport: { prefix: 'psr', scope: 'org' },
  PatientShareCase: { prefix: 'psc', scope: 'org' },
  PatientShareConsent: { prefix: 'pscon', scope: 'org' },
  PatientShareCorrectionRequest: { prefix: 'pscr', scope: 'org' },
  PcaPump: { prefix: 'pca', scope: 'org' },
  PcaPumpMaintenanceEvent: { prefix: 'pcam', scope: 'org' },
  PcaPumpRental: { prefix: 'pcar', scope: 'org' },
  PcaPumpRentalAccessory: { prefix: 'pcara', scope: 'org' },
  PharmacistCredential: { prefix: 'phcr', scope: 'org' },
  PharmacistShift: { prefix: 'phsh', scope: 'org' },
  PharmacistShiftTemplate: { prefix: 'phst', scope: 'org' },
  PharmacyContract: { prefix: 'phct', scope: 'org' },
  PharmacyContractFeeRule: { prefix: 'phcf', scope: 'org' },
  PharmacyContractVersion: { prefix: 'phcv', scope: 'org' },
  PharmacyCooperationMessage: { prefix: 'phcm', scope: 'org' },
  PharmacyCooperationMessageThread: { prefix: 'phcmt', scope: 'org' },
  PharmacyDrugStock: { prefix: 'phds', scope: 'org' },
  PharmacyInvoice: { prefix: 'phin', scope: 'org' },
  PharmacyInvoiceItem: { prefix: 'phini', scope: 'org' },
  PharmacyOperatingHours: { prefix: 'phoh', scope: 'org' },
  PharmacyPartnership: { prefix: 'phpa', scope: 'org' },
  PharmacySite: { prefix: 'phs', scope: 'org' },
  PharmacySiteInsuranceConfig: { prefix: 'phsic', scope: 'org' },
  PharmacyVisitRequest: { prefix: 'phvr', scope: 'org' },
  // Platform operators have no org_id; tenant-visible staff IDs are Membership.display_id.
  PlatformOperator: { prefix: 'plop', scope: 'global' },
  PrescriberInstitution: { prefix: 'prin', scope: 'org' },
  PrescriptionIntake: { prefix: 'r', scope: 'org' },
  PrescriptionLine: { prefix: 'rxl', scope: 'org' },
  PushSubscription: { prefix: 'push', scope: 'org' },
  QrScanDraft: { prefix: 'q', scope: 'org' },
  Residence: { prefix: 'res', scope: 'org' },
  ResidualMedication: { prefix: 'rmed', scope: 'org' },
  SavedView: { prefix: 'sv', scope: 'org' },
  ServiceArea: { prefix: 'sarea', scope: 'org' },
  SetAudit: { prefix: 'seta', scope: 'org' },
  SetBatch: { prefix: 's', scope: 'org' },
  SetBatchChangeLog: { prefix: 'sbcl', scope: 'org' },
  SetPlan: { prefix: 'setp', scope: 'org' },
  SourceOfTruthMatrix: { prefix: 'sot', scope: 'org' },
  SpecialPatientStatus: { prefix: 'spst', scope: 'org' },
  Task: { prefix: 't', scope: 'org' },
  TaskComment: { prefix: 'tc', scope: 'org' },
  Template: { prefix: 'tpl', scope: 'org' },
  TracingReport: { prefix: 'trc', scope: 'org' },
  UatFeedback: { prefix: 'uat', scope: 'org' },
  // Multi-org identity record; tenant-visible staff/user numbering lives on Membership.display_id.
  User: { prefix: 'u', scope: 'global' },
  VisitBillingCandidate: { prefix: 'vbc', scope: 'org' },
  VisitHandoffExtraction: { prefix: 'vhe', scope: 'org' },
  VisitInstruction: { prefix: 'vins', scope: 'org' },
  VisitPreparation: { prefix: 'vprep', scope: 'org' },
  VisitRecord: { prefix: 'v', scope: 'org' },
  VisitSchedule: { prefix: 'vsch', scope: 'org' },
  VisitScheduleContactLog: { prefix: 'vscl', scope: 'org' },
  VisitScheduleOverride: { prefix: 'vso', scope: 'org' },
  VisitScheduleProposal: { prefix: 'vsp', scope: 'org' },
  VisitScheduleProposalBatch: { prefix: 'vspb', scope: 'org' },
  VisitVehicleResource: { prefix: 'vvr', scope: 'org' },
  WebhookDelivery: { prefix: 'whd', scope: 'org' },
  WebhookRegistration: { prefix: 'whr', scope: 'org' },
  WorkflowException: { prefix: 'w', scope: 'org' },
} as const satisfies Record<string, DisplayIdRegistryEntry>;

export type DisplayIdModel = keyof typeof DISPLAY_ID_REGISTRY;
export type DisplayIdPrefix = (typeof DISPLAY_ID_REGISTRY)[DisplayIdModel]['prefix'];
export type DisplayIdExcludedModel = (typeof DISPLAY_ID_EXCLUDED_MODELS)[number];
export type DisplayIdInfrastructureModel = (typeof DISPLAY_ID_INFRASTRUCTURE_MODELS)[number];
export type ReservedDisplayIdPrefix = (typeof RESERVED_DISPLAY_ID_PREFIXES)[number];

const registryEntries = Object.entries(DISPLAY_ID_REGISTRY) as Array<
  [DisplayIdModel, (typeof DISPLAY_ID_REGISTRY)[DisplayIdModel]]
>;

const displayIdModelByPrefix = Object.fromEntries(
  registryEntries.map(([model, entry]) => [entry.prefix, model]),
) as Record<DisplayIdPrefix, DisplayIdModel>;

export function getDisplayIdRegistryEntry(
  model: DisplayIdModel,
): (typeof DISPLAY_ID_REGISTRY)[DisplayIdModel] {
  return DISPLAY_ID_REGISTRY[model];
}

export function getDisplayIdModelForPrefix(prefix: string): DisplayIdModel | undefined {
  return (displayIdModelByPrefix as Record<string, DisplayIdModel | undefined>)[prefix];
}

export function isDisplayIdModel(model: string): model is DisplayIdModel {
  return Object.prototype.hasOwnProperty.call(DISPLAY_ID_REGISTRY, model);
}

export function isReservedDisplayIdPrefix(prefix: string): prefix is ReservedDisplayIdPrefix {
  return (RESERVED_DISPLAY_ID_PREFIXES as readonly string[]).includes(prefix);
}
