# PH-OS / yrese FHIR Native 処方・臨床連携契約 v0.5

- Task: `FHIR-NATIVE-P0-FOUNDATION-001-DOCS`
- Decision date: 2026-07-15
- Official references confirmed: 2026-07-15
- Status: P0 complete-replacement contract accepted / machine-readable foundation ratchet active / runtime implementation blocked until downstream gates close
- Runtime status: FHIR Resource Store、標準 validator、FHIR REST endpoint は未実装

## 1. 目的と適用範囲

PH-OS と yrese は、FHIR R4 Resource 自体を内部 Clinical Core とする。FHIR は legacy model から
生成する交換用 DTO や出力 projection ではない。本書は v0.2〜v0.4 の段階移行案を置換する
v0.5 の実装前契約であり、次を固定する。

- FHIR / JP Core の採用版
- Resource ごとの authoritative owner、現在地、目標 adoption level、許可 interaction
- profile、extension、terminology、ConceptMap、identifier namespace の登録規則
- FHIR Clinical Data、Technical Control、Legacy / Official Adapter の 3 plane
- yrese と PH-OS の authoritative server、read-only replica、canonical replica identity
- JAHIS、NSIPS、電子処方箋、paper/fax/manual の Adapter Plane 境界
- Bundle、validation、quarantine、audit、consent、offline、round-trip の停止条件
- deterministic one-way conversion、full reconciliation、write freeze、single hard cutover、
  irreversible commit point 前の whole-release + recovery-set snapshot abort

旧実装との runtime 後方互換、新旧二系統の同時読み書き、旧経路への退避、source 単位の
段階切替、互換用派生データは採用しない。本書は FHIR 対応完了や外部 API 公開を宣言しない。
実装済み能力は live route、schema、test、`CapabilityStatement` の一致でのみ判断する。

### 1.1 Machine-readable foundation gate

本書の自由記述だけを実装契約にしない。次の3 artifactとCI gateを同じfoundation SSOTとして扱う。

- Resource、Search、Retention、Access、identifier、3 plane、Capability、27 child graph:
  [`tools/fhir-native/foundation-registry.json`](../../tools/fhir-native/foundation-registry.json)
- FHIR / JP Core / dependencyのversion、official source URL、SHA-256:
  [`tools/fhir-native/package-lock.json`](../../tools/fhir-native/package-lock.json)
- repository URL、base commit、dirty/exclusion disclosure、対象artifact hash、非runtime build manifest:
  [`tools/fhir-native/source-baseline.json`](../../tools/fhir-native/source-baseline.json)
- fail-closed command: `pnpm fhir-native:foundation:check`

このgateは文書とregistry、active `Plans.md`、live version literal、legacy Prisma enum、FHIR route、
package/CI wiring、source artifact hashの差分を検出する。現時点のCapabilityは`not-implemented`、
FHIR routeは0件、custom extensionは0件であり、gate追加をFHIR runtime完成やJP Core validation済みの
証拠として扱わない。

## 2. 採用版と一次資料

この節の URL、公開版、package 版はすべて **2026-07-15** に一次資料で確認した。
将来の更新日は Decision date と分けてこの確認日を更新し、確認していない版を current と記載しない。

| 項目                      | 固定値 / 一次資料                                                                                                                                                                                                          | 契約                                                                                                                                                                                                        |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FHIR                      | [FHIR R4 4.0.1](https://hl7.org/fhir/R4/)                                                                                                                                                                                  | R5 へ暗黙変換しない。Resource version と FHIR release を別属性で保持する。                                                                                                                                  |
| JP Core                   | [`jpfhir.jp.core#1.2.0`](https://jpfhir.jp/fhir/core/1.2.0/)                                                                                                                                                               | 1.3.0-dev 等の開発版を production contract にしない。                                                                                                                                                       |
| package                   | [JP Core 1.2.0 package / definitions / examples](https://jpfhir.jp/fhir/core/1.2.0/download.html)                                                                                                                          | validator は package と terminology snapshot を hash 付きで pin する。Web ページの文字列比較だけで validation しない。                                                                                      |
| profile inventory         | [JP Core 1.2.0 contents](https://jpfhir.jp/fhir/core/1.2.0/)                                                                                                                                                               | JP Core に profile がある Resource は批准済み profile を使い、ない Resource は FHIR Base R4 または批准済み PH-OS profile と明示する。                                                                       |
| validation                | [FHIR R4 Validation](https://hl7.org/fhir/R4/validation.html)、[FHIR R4 JSON](https://hl7.org/fhir/R4/json.html)、[JP Core Patient 1.2.0](https://jpfhir.jp/fhir/core/1.2.0/StructureDefinition-jp-patient.html)           | structure、cardinality、slicing、invariant、binding、profile、Questionnaire を標準 validator path で検証する。FHIR primitive配列のnull placeholderとJP Core cardinalityを独自shape ruleで上書きしない。     |
| Bundle                    | [FHIR R4 Bundle](https://hl7.org/fhir/R4/bundle.html)                                                                                                                                                                      | 全 entry、参照関係、Bundle type、原子性を処理し、先頭 entry だけを成功扱いしない。                                                                                                                          |
| search / capability       | [FHIR R4 Search Parameter Registry](https://hl7.org/fhir/R4/searchparameter-registry.html)、[CapabilityStatement](https://hl7.org/fhir/R4/capabilitystatement.html)                                                        | §5 の Resource 行は R4 定義済み parameter だけを参照し、実装・認可・budget がそろった subset だけを CapabilityStatement へ宣言する。                                                                        |
| Binary / Attachment       | [FHIR R4 Binary](https://hl7.org/fhir/R4/binary.html)、[FHIR R4 Attachment](https://hl7.org/fhir/R4/datatypes.html#Attachment)                                                                                             | FHIR 管理下の本文は `Binary` Resource とし、外部暗号化 object は Source Artifact として分離する。Binary は search 非対応、`Attachment.hash` は SHA-1/base64 であり、保全 manifest の SHA-256 と混同しない。 |
| Provenance / access audit | [FHIR R4 Provenance](https://hl7.org/fhir/R4/provenance.html)、[AuditEvent](https://hl7.org/fhir/R4/auditevent.html)、[JP Core Security](https://jpfhir.jp/fhir/core/1.2.0/security.html)                                  | Resource の生成・変換と、閲覧・出力・認可判断を別 event として残す。                                                                                                                                        |
| JAHIS お薬手帳            | [JAHIS 技術文書 24-104 Ver.2.6](https://www.jahis.jp/standard/detail/id=1124)                                                                                                                                              | `JAHISTC08` を処方箋原本や確定 MedicationRequest へ自動昇格しない。                                                                                                                                         |
| JAHIS 院外処方箋 symbol   | [JAHIS 技術文書 26-101 Ver.1.11](https://www.jahis.jp/standard/detail/id=1233)                                                                                                                                             | お薬手帳 QR と別 adapter、別 source authority として扱う。                                                                                                                                                  |
| JAHIS 薬局内連携          | [JAHIS 技術文書 24-105 Ver.1.1](https://www.jahis.jp/standard/detail/id=1129)                                                                                                                                              | レセコン・電子薬歴間の方向別 dataset とし、FHIR schema へ直接混入させない。                                                                                                                                 |
| NSIPS                     | [日本薬剤師会 NSIPS](https://www.nichiyaku.or.jp/yakuzaishi/activities/nsips)、[FAQ](https://www.nichiyaku.or.jp/yakuzaishi/activities/nsips/faq)、[利用申請](https://www.nichiyaku.or.jp/yakuzaishi/activities/nsips/use) | Ver.1.07.01。加入・審査・実装主体・施設内外 scope が文書化されるまで parser、fixture、互換宣言を作らない。                                                                                                  |
| 電子処方箋                | [厚生労働省 システムベンダ向け資料](https://www.mhlw.go.jp/stf/seisakunitsuite/bunya/denshishohousen_systemvendor.html)                                                                                                    | 医療機関等 ONS、技術解説書 2.04、self-checklist 4.2 を yrese Official Adapter 境界で扱う。FHIR/JP Core を ONS transport・署名・記録条件の代替にしない。                                                     |

版更新は package、profile registry、terminology snapshot、ConceptMap、CapabilityStatement、
round-trip fixture を同じ migration group で更新する。どれか一つだけの更新は禁止する。

2026-07-15にofficial downloadから取得した`jpfhir.jp.core#1.2.0` artifactはSHA-256をlockした一方、
内包`package.json`に`notForPublication: true`と`file://` build URLがあり、公開履歴のcurrent表示と
metadata上の差異がある。またterminology dependency keyと実artifact package nameにも差異がある。
したがってこのlockはfoundation provenanceに限定し、A5がartifact suitability、dependency closure、
offline resolutionを解決するまでruntime validatorへ供給せず、validation可能とも宣言しない。

実装開始時は、上記標準packageだけでなく対象repositoryのremote URL、exact commit SHA、branch、dirty/clean状態、
task対象diff hashをsource baseline manifestへ固定する。dirty treeを基準にする場合は対象pathと除外pathを列挙し、
同じsource artifactを再構築できない状態でschema、validator、converter、cutover artifactを作らない。

## 3. Target Architecture: Three Planes

| Plane                     | Canonical responsibility                                                                                                                                                                                                                         | Must not contain                                                                                                                                         |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FHIR Clinical Data Plane  | FHIR R4 Resource Version、current head、reference graph、SearchParameter index、history、transaction、Subscription、owner-side Provenance / AuditEvent。UI を含む全 clinical consumer が使う。                                                   | legacy clinical aggregate、旧 API DTO、adapter 固有 field、retry/lease/feature flag、請求・会計 aggregate。                                              |
| Technical Control Plane   | tenant、identity、qualification、authorization、Consent predicate、workflow claim/lease、opaque Resource/version/hash outbox、retry、conflict、quarantine、raw-ingress処理状態とopaque raw-vault reference、retention、encryption、audit chain。 | 臨床payload、raw payload、FHIR Resource/Bundleの複製、custom event DTO、FHIR statusの独自コピー、external format fieldをResourceの代わりに正本化する列。 |
| Legacy / Official Adapter | JAHIS、NSIPS、電子処方箋、paper/fax/manual、旧 clinical model の versioned decoder/encoder と、FHIR Resource への deterministic mapping。                                                                                                        | clinical current head、FHIR REST の代替 endpoint、adapter DTO を UI へ直接返す経路、cutover 後の旧 schema writer/reader。                                |

Clinical API は FHIR REST、transaction Bundle、Subscription、Resource history だけを公開する。
PH-OS UI と yrese UI も同じ Data Plane を利用し、UI 専用 clinical API や旧 DTO import を作らない。Technical
Control API は claim、approval、quarantine、adapter operation 等に限定し、FHIR Resource を独自 DTO に
包んで正本化しない。SMART on FHIR、Bulk Data、CDS Hooks は core cutover 後の ecosystem task とする。
Legacy converter は cutover 専用 artifact であり、新 release の production runtime へ同梱しない。
Official Adapter だけを versioned production component として残す。
`YreseOutboundEvent` 等の delivery record は opaque な authoritative base URL、Resource type/logical ID、
version/hash、delivery state、attempt/cursor だけを持つ。臨床payloadは FHIR Resource Store に一度だけ保存し、
送信時は owner-side Resource から標準 transaction Bundle を構築する。custom event payloadへ複製しない。

Target の不変条件:

- 同じ Resource identity に writable owner は一つだけであり、same-resource multi-master を禁止する。
- 相手 server 所有 Resource は immutable version と current head を持つ read-only replica にする。
- replica identity は `authoritative base URL + resourceType + logical id + versionId` を主キーとし、
  payload hash を同一 version の改ざん・不一致検出に使う。
- yrese claim/accounting domain は FHIR Resource/version reference を保持するが、請求・会計を
  PH-OS FHIR extension や PH-OS clinical Resource に押し込まない。
- `CapabilityStatement` は registry と live route から生成し、未実装 interaction を宣言しない。

## 4. System of Record と write ownership

| Data class                                                                                                                                                 | Authoritative server / source             | Replica and write contract                                                                                                                                                        |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Patient、Coverage、Organization、Location、Practitioner、PractitionerRole、Medication、MedicationRequest、MedicationDispense                               | yrese / qualified identity or drug source | PH-OS は versioned read-only replica を持つ。修正・取消・疑義は Task / Communication として owner に送るが、相手所有 Resource version を PH-OS が生成しない。                     |
| 電子処方箋、調剤確定、claim、accounting                                                                                                                    | yrese / Official Adapter                  | yrese の処方・調剤 server と claim/accounting domain が正本。claim/accounting record は FHIR Resource/version を参照し、PH-OS は独自確定しない。                                  |
| JAHISTC08                                                                                                                                                  | 患者提供 source + 発行元記録              | Adapter Plane が MedicationStatement / reconciliation evidence へ変換する。批准済み完全性と provenance がある場合だけ history evidence を認め、MedicationRequest を生成しない。   |
| 院外処方箋 symbol、paper、fax、manual                                                                                                                      | 原本、または yrese で確定した処方         | Adapter Plane が MedicationRequest candidate + DocumentReference を作り、人手 review 後に yrese authoritative write command へ接続する。PH-OS を処方正本にしない。                |
| MedicationStatement、Observation、Encounter、CarePlan、Task、Appointment、Communication、QuestionnaireResponse、DetectedIssue candidate、DocumentReference | PH-OS home-care / medication-use server   | PH-OS が owner-side Resource Version、Provenance、outbox を原子的に保存する。yrese は必要なものだけ read-only replica とし、請求・調剤を自動確定しない。                          |
| Consent                                                                                                                                                    | purpose/profile ごとの指定 server         | PH-OS home-care consent と yrese prescription/dispensing consent を別 profile/owner とする。受信 Consent は read-only replica。片方の Consent を他方の purpose へ暗黙転用しない。 |
| CareTeam                                                                                                                                                   | **UNRESOLVED — Phase 0 owner decision**   | owner、profile、identifier namespace、replica direction が批准されるまで native current head、search、write、同期を作らない。                                                     |
| Provenance、AuditEvent                                                                                                                                     | event を発生させた各 server               | server-local evidence であり相手 server の監査正本を上書きしない。cross-server correlation は canonical Resource identity と event identifier で行う。                            |
| sync claim、retry、conflict、local draft、route、feature flag、offline edit state                                                                          | 各 server の Technical Control Plane      | FHIR extension に押し込まず、canonical Resource/version reference を保持する。                                                                                                    |

## 5. Resource Inventory

`Legacy inventory` は 2026-07-15 の削除対象となる live 実装の gap evidence であり、cutover 後の
並存能力ではない。`L0` は未登録、`L1` は legacy metadata/cache、`L2` は pinned package で検証した
read-only replica、`L3` は authoritative native Resource store、`L4` は live CapabilityStatement と
一致する FHIR endpoint を表す。Target は hard cutover の必須到達状態である。

| Resource              | Legacy inventory      | Native target                       | Authoritative server                | Native interaction                          | Profile policy / note                                                                                                                                                                                                                                                     | Search        | Retention      | Consent / purpose  |
| --------------------- | --------------------- | ----------------------------------- | ----------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | -------------- | ------------------ |
| Patient               | L1                    | L2                                  | yrese                               | read, indexed search                        | JP Core Patient 1.2.0                                                                                                                                                                                                                                                     | `S-PATIENT`   | `R-REPLICA`    | `A-CLINICAL-READ`  |
| Coverage              | L1                    | L2                                  | yrese                               | read, indexed search                        | JP Core Coverage 1.2.0                                                                                                                                                                                                                                                    | `S-COVERAGE`  | `R-REPLICA`    | `A-CLINICAL-READ`  |
| Organization          | L1                    | L2                                  | yrese / qualified source            | read, indexed search                        | JP Core Organization 1.2.0                                                                                                                                                                                                                                                | `S-ORG`       | `R-REPLICA`    | `A-IDENTITY`       |
| Location              | L0、enum 未登録       | L2                                  | yrese                               | read, indexed search                        | JP Core Location 1.2.0。PH-OS の訪問経路・最適化状態を混入させない。                                                                                                                                                                                                      | `S-LOCATION`  | `R-REPLICA`    | `A-IDENTITY`       |
| Practitioner          | L1                    | L2                                  | qualified identity source           | read, indexed search                        | JP Core Practitioner 1.2.0。資格認可の正本を Resource 表示だけに依存させない。                                                                                                                                                                                            | `S-PRACT`     | `R-REPLICA`    | `A-IDENTITY`       |
| PractitionerRole      | L1                    | L2                                  | yrese / tenant identity             | read, indexed search                        | JP Core PractitionerRole 1.2.0。tenant role と薬剤師資格を混同しない。                                                                                                                                                                                                    | `S-PRACTROLE` | `R-REPLICA`    | `A-IDENTITY`       |
| Medication            | L1                    | L2                                  | yrese / approved drug source        | read, reference resolution                  | JP Core Medication は注射薬剤リスト用途。内服・外用へ単独適用しない。                                                                                                                                                                                                     | `S-MED`       | `R-REPLICA`    | `A-REFERENCE`      |
| MedicationRequest     | L1                    | L2                                  | yrese                               | read, indexed search                        | JP Core MedicationRequest または Injection。source category で選ぶ。                                                                                                                                                                                                      | `S-MEDREQ`    | `R-REPLICA`    | `A-CLINICAL-READ`  |
| MedicationDispense    | L1                    | L2                                  | yrese                               | read, indexed search                        | JP Core MedicationDispense または Injection。PH-OS create は禁止。                                                                                                                                                                                                        | `S-MEDDISP`   | `R-REPLICA`    | `A-CLINICAL-READ`  |
| MedicationStatement   | L1                    | L2 inbound / L3 PH-OS-owned         | source-specific                     | read, indexed search; approved PH-OS create | JP Core MedicationStatement または Injection。source authority と verification state を必須化する。                                                                                                                                                                       | `S-MEDSTMT`   | `R-CLINICAL`   | `A-CLINICAL-WRITE` |
| AllergyIntolerance    | L1 metadata only      | L2                                  | yrese / qualified clinical source   | read, indexed search                        | JP Core AllergyIntolerance 1.2.0                                                                                                                                                                                                                                          | `S-ALLERGY`   | `R-REPLICA`    | `A-CLINICAL-READ`  |
| Condition             | L1 metadata only      | L2                                  | yrese / qualified clinical source   | read, indexed search                        | JP Core Condition / Diagnosis を semantics に応じて選ぶ。                                                                                                                                                                                                                 | `S-CONDITION` | `R-REPLICA`    | `A-CLINICAL-READ`  |
| Observation           | L1 metadata only      | L2 inbound / L3 PH-OS-owned         | source-specific                     | read, indexed search; approved PH-OS create | JP Core の category-specific Observation profile を使う。Common だけで適合宣言しない。                                                                                                                                                                                    | `S-OBS`       | `R-CLINICAL`   | `A-CLINICAL-WRITE` |
| Encounter             | L1 metadata only      | L2 inbound / L3 PH-OS-owned         | source-specific                     | read, indexed search; approved PH-OS create | JP Core Encounter 1.2.0                                                                                                                                                                                                                                                   | `S-ENCOUNTER` | `R-CLINICAL`   | `A-CLINICAL-WRITE` |
| CarePlan              | L1 metadata only      | L3                                  | PH-OS home-care                     | read; approved create/update                | JP Core profile なし。FHIR Base R4 または批准済み PH-OS profile。                                                                                                                                                                                                         | `S-CAREPLAN`  | `R-CLINICAL`   | `A-CLINICAL-WRITE` |
| Task                  | L1 metadata only      | L3                                  | PH-OS Workflow / home-care          | read; approved create/update                | FHIR Base R4。claim/lease/dedupe は Workflow Store に残す。                                                                                                                                                                                                               | `S-TASK`      | `R-WORKFLOW`   | `A-WORKFLOW`       |
| Appointment           | L1 metadata only      | L3                                  | PH-OS home-care                     | read; approved create/update                | FHIR Base R4。配送順・最適化状態は含めない。                                                                                                                                                                                                                              | `S-APPT`      | `R-WORKFLOW`   | `A-WORKFLOW`       |
| Communication         | L1 metadata only      | L3                                  | PH-OS home-care                     | read; approved create                       | FHIR Base R4。外部送信許可とは別 gate。                                                                                                                                                                                                                                   | `S-COMM`      | `R-CLINICAL`   | `A-COMMUNICATION`  |
| QuestionnaireResponse | L0、enum 未登録       | L3                                  | PH-OS home-care                     | read; approved create/update                | FHIR Base R4。replacement schema migration + human DB review 後に有効化する。                                                                                                                                                                                             | `S-QR`        | `R-CLINICAL`   | `A-CLINICAL-WRITE` |
| DetectedIssue         | L0、enum 未登録       | L3 candidate                        | PH-OS home-care                     | read; approved candidate create/update      | FHIR Base R4。疑義・相互作用等の review candidate に限定し、相手所有 Resource の自動変更に使わない。                                                                                                                                                                      | `S-DETECTED`  | `R-CLINICAL`   | `A-CLINICAL-WRITE` |
| DocumentReference     | L1 metadata only      | L3                                  | source-specific / PH-OS             | read; approved create                       | FHIR Base R4。binary 本文・signed URL・storage key を埋め込まない。                                                                                                                                                                                                       | `S-DOC`       | `R-DOCUMENT`   | `A-DOCUMENT`       |
| Binary                | L0、enum 未登録       | L2 conditional owner-scoped         | referencing DocumentReference owner | read through authorized reference only      | FHIR Base R4 Binary。FHIR REST 管理を選ぶ場合だけ使用し、peer は read-only。外部暗号化 object は Resource にせず Source Artifact とする。`Attachment.hash` の SHA-1 と別に manifest 用 SHA-256 を保持し、raw/presigned URL を Resource、Control Plane、log へ保存しない。 | `S-NONE`      | `R-DOCUMENT`   | `A-DOCUMENT`       |
| Consent               | L1 metadata only      | L2 replica / L3 owner-local         | purpose/profile-designated server   | read; owner-approved create/update          | FHIR Base R4。home-care と prescription/dispensing の profile/owner を分離し、purpose を暗黙転用しない。                                                                                                                                                                  | `S-CONSENT`   | `R-CONSENT`    | `A-CONSENT`        |
| CareTeam              | L1 metadata only      | UNRESOLVED                          | Phase 0 owner decision required     | none until owner/profile approval           | FHIR Base R4 candidate。tenant assignment を Resource だけから推測せず、owner を決めるまで昇格しない。                                                                                                                                                                    | `S-NONE`      | `R-QUARANTINE` | `A-QUARANTINE`     |
| Provenance            | legacy event only     | L3 server-local evidence            | event-origin server                 | read; append owner-local evidence           | FHIR Base R4。Resource/version の生成・変換用。相手 server の evidence を上書きしない。                                                                                                                                                                                   | `S-PROV`      | `R-EVENT`      | `A-SECURITY`       |
| AuditEvent            | legacy audit only     | L3 server-local evidence            | event-origin server                 | tenant read; append owner-local evidence    | FHIR Base R4。access/output/authz evidence。監査実行と閲覧を分け、相手 server の監査正本を上書きしない。                                                                                                                                                                  | `S-AUDIT`     | `R-EVENT`      | `A-SECURITY`       |
| Bundle                | L1 transport metadata | L1 transport / L4 endpoint envelope | sender + receiver contract          | validate and dispatch all entries           | JP Core は Bundle profile を定義せず FHIR Base R4 を使う。Bundle 自体を臨床正本にしない。                                                                                                                                                                                 | `S-NONE`      | `R-TRANSIENT`  | `A-TRANSPORT`      |
| other                 | L1 hash/metadata      | quarantine only                     | unknown                             | none                                        | allowlist 外 Resource。canonical current head、search index、workflow reference を作らない。                                                                                                                                                                              | `S-NONE`      | `R-QUARANTINE` | `A-QUARANTINE`     |

L4 interaction は §11 の endpoint gate を満たすまで全 Resource で未承認であり、hard cutover 前に
legacy endpoint へ退避する経路は作らない。

`CapabilityStatement`、`OperationOutcome`、`StructureDefinition`、`ValueSet`、`CodeSystem`、
`ConceptMap`、`Questionnaire` は conformance / control artifact として別 registry で version と
hash を pin し、tenant clinical current head にはしない。`QuestionnaireResponse.questionnaire` は
批准済み canonical + version に exact 解決できなければ quarantine する。

### 5.1 Search key registry

各 key は tenant predicate、approved index、query budget、pagination、監査を伴う。ここにない
parameter の scan/filter fallback は禁止し、L4 では実装済み parameter だけを宣言する。

| Key           | Approved indexed parameters                                                       |
| ------------- | --------------------------------------------------------------------------------- |
| `S-PATIENT`   | `_id`, `identifier`                                                               |
| `S-COVERAGE`  | `_id`, `identifier`, `beneficiary`, `status`                                      |
| `S-ORG`       | `_id`, `identifier`, `name`                                                       |
| `S-LOCATION`  | `_id`, `identifier`, `name`, `organization`, `status`                             |
| `S-PRACT`     | `_id`, `identifier`                                                               |
| `S-PRACTROLE` | `_id`, `identifier`, `practitioner`, `organization`, `active`                     |
| `S-MED`       | `_id`, `code`                                                                     |
| `S-MEDREQ`    | `_id`, `identifier`, `patient`, `authoredon`, `status`, `code`                    |
| `S-MEDDISP`   | `_id`, `identifier`, `patient`, `whenhandedover`, `status`, `code`                |
| `S-MEDSTMT`   | `_id`, `identifier`, `patient`, `effective`, `status`, `code`                     |
| `S-ALLERGY`   | `_id`, `patient`, `clinical-status`, `code`, `date`                               |
| `S-CONDITION` | `_id`, `patient`, `clinical-status`, `code`                                       |
| `S-OBS`       | `_id`, `patient`, `category`, `code`, `date`, `status`                            |
| `S-ENCOUNTER` | `_id`, `patient`, `date`, `status`, `class`                                       |
| `S-CAREPLAN`  | `_id`, `patient`, `date`, `status`                                                |
| `S-TASK`      | `_id`, `patient`, `owner`, `status`, `authored-on`                                |
| `S-APPT`      | `_id`, `patient`, `date`, `status`, `actor`                                       |
| `S-COMM`      | `_id`, `patient`, `sent`, `status`, `recipient`                                   |
| `S-QR`        | `_id`, `patient`, `authored`, `status`, `questionnaire`                           |
| `S-DETECTED`  | `_id`, `identifier`, `patient`, `code`, `identified`, `implicated`, `author`      |
| `S-DOC`       | `_id`, `patient`, `date`, `status`, `type`                                        |
| `S-CONSENT`   | `_id`, `patient`, `date`, `status`, `scope`                                       |
| `S-PROV`      | `_id`, `target`, `recorded`, `agent`                                              |
| `S-AUDIT`     | `_id`, `date`, `agent`, `entity`, `outcome`; security/compliance scope only       |
| `S-NONE`      | Resource search なし。Bundle dispatch または quarantine review の exact ID のみ。 |

### 5.2 Retention key registry

各 key は実装前に approved schedule ID、開始 event、期間、legal hold、purge actor、証跡を持つ。
期間未批准時の default は「保存してよい」ではなく native replica/owner commit の停止である。

| Key            | Retention contract                                                                                                              |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `R-REPLICA`    | source/contract と法定記録 schedule に従う immutable version。削除通知も tombstone + Provenance とし、PH-OS が独自短縮しない。  |
| `R-CLINICAL`   | 批准済み臨床記録 schedule。Resource version、current head、Provenance、参照整合を同じ hold/purge decision で扱う。              |
| `R-WORKFLOW`   | 業務完了 event 起点の運用 schedule。臨床判断に利用された snapshot は `R-CLINICAL` へ固定し、workflow purge に巻き込まない。     |
| `R-DOCUMENT`   | metadata と source artifact の schedule を関連付けるが、binary/FileAsset は別 retention/access policy とする。                  |
| `R-CONSENT`    | effective/withdrawn/superseded の証跡を批准済み同意 schedule で保持し、withdrawal を物理削除で表現しない。                      |
| `R-EVENT`      | append-only security/audit schedule。対象 Resource purge 後も必要最小の非 PHI decision evidence と chain integrity を維持する。 |
| `R-TRANSIENT`  | 全 entry の成功・隔離・再試行確定 + replay window まで。Bundle 自体を clinical current head にしない。                          |
| `R-QUARANTINE` | source/use-case ごとの TTL + legal hold。通常 current head/search へ出さず、期限到来時も hold/review/audit を経て purge する。  |

### 5.3 Consent / purpose key registry

全 key に explicit tenant、authenticated actor、assignment、purpose、deny audit を適用する。
read、write、external output、offline carry は互いを包含しない。

| Key                | Consent / purpose contract                                                                                                                                         |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `A-CLINICAL-READ`  | care/dispensing/authorized operations purpose + effective consent/法的根拠。認可済み clerk は tenant 内を閲覧可。export/print/share/offline は別 gate。            |
| `A-IDENTITY`       | identity/tenant administration または care purpose。Practitioner 表示から role・assignment・薬剤師資格を推定せず canonical registry を再評価する。                 |
| `A-REFERENCE`      | authenticated tenant の clinical/reference purpose。patient-linked query は `A-CLINICAL-READ` も満たす。                                                           |
| `A-CLINICAL-WRITE` | `A-CLINICAL-READ` + Resource/action 固有 authoring capability。薬歴記載・報告書作成・監査実行は canonical verified/current 薬剤師資格を server で再評価する。      |
| `A-WORKFLOW`       | tenant/assignment/purpose。認可済み clerk は read と非臨床運用 action のみ。臨床確定・監査 mutation は action 固有 gate を通す。                                   |
| `A-COMMUNICATION`  | care coordination purpose + consent/legal basis + intended recipient。外部送信、添付、再送、export は別 approval/audit/retention gate。                            |
| `A-DOCUMENT`       | `A-CLINICAL-READ` + source artifact access。binary、signed URL、download、print、external share は別 capability と短期 access grant を要求する。                   |
| `A-CONSENT`        | consent administration authority + stated purpose。対象 Consent 自体を、その Consent の作成・撤回権限を正当化する循環根拠にしない。                                |
| `A-SECURITY`       | 認可済み tenant の audit/evidence read は clerk を含めて許可する。監査実行、append、governance、cross-tenant oversight、export、raw security log は別 capability。 |
| `A-TRANSPORT`      | authenticated adapter/use-case + Bundle type。各 entry Resource の tenant/purpose/consent/write owner を個別評価し、Bundle 単位の blanket grant を禁止する。       |
| `A-QUARANTINE`     | 明示 review assignment、reason、必要な step-up。通常 read/search へ公開せず、replay 時に最新 profile/terminology/identity/consent を再評価する。                   |

Resource 行にない暗黙 default key は存在しない。新 Resource は owner、interaction、profile、
search、retention、consent/purpose の全列と対応 registry key を同じ変更で追加する。

## 6. Profile / Extension Registry

### 6.1 Profile families

| Resource family                                                                                                                                        | Approved profile source                    | Selection rule                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------ | ------------------------------------------------------------------------------------------- |
| Patient / Coverage / Encounter / Organization / Location / Practitioner / PractitionerRole                                                             | JP Core 1.2.0 Administration profiles      | package canonical URL と version を validator が解決する。                                  |
| MedicationRequest / MedicationDispense / MedicationStatement                                                                                           | JP Core 1.2.0 Medication profiles          | 内服・外用と Injection を source category で分け、片方への黙示変換をしない。                |
| Medication                                                                                                                                             | JP Core 1.2.0 Medication profile           | Injection profile から参照される薬剤リスト用途に限定する。                                  |
| Observation                                                                                                                                            | JP Core 1.2.0 category-specific profile    | source observation category と一致する profile を選ぶ。unsupported category は quarantine。 |
| AllergyIntolerance / Condition                                                                                                                         | JP Core 1.2.0 Clinical profiles            | Condition と Diagnosis の意味を mapping registry で分ける。                                 |
| Questionnaire                                                                                                                                          | FHIR Base R4 conformance artifact          | canonical、version、hash を pin し、QuestionnaireResponse validation の参照元に限定する。   |
| CarePlan / Task / Appointment / Communication / QuestionnaireResponse / DetectedIssue / DocumentReference / Binary / Consent / Provenance / AuditEvent | FHIR Base R4、または批准済み PH-OS profile | PH-OS custom profile は医療・privacy・security review と package 化前に使用しない。         |
| CareTeam                                                                                                                                               | UNRESOLVED                                 | Phase 0 で owner、profile、identifier、replica direction を同時批准するまで使用しない。     |
| Bundle                                                                                                                                                 | FHIR Base R4                               | Bundle type と用途別 contract を別に検証する。                                              |

`meta.profile` の自己申告、URL の存在、TypeScript shape の成功だけで `valid` にしない。
profile URL は package 内 canonical と完全一致させ、http/https や大文字小文字の独自補正をしない。

### 6.2 Extension policy

- 承認済み extension は pinned JP Core 1.2.0 package に含まれるものだけである。
- PH-OS custom extension の approved registry は現在 0 件である。
- custom extension を追加する場合は canonical URL、owner、対象 Resource、value type、cardinality、
  invariant、terminology、search、retention、migration、round-trip fixture を一組で批准する。
- sync claim、retry、conflict、tenant role、route、feature flag、UI state、local draft を extension にしない。
- unknown modifier extension、解決不能な必須 extension、意味が変わる未対応 extension は quarantine する。
  通常 extension を serializer が黙って削除することも禁止する。

## 7. Terminology / ConceptMap Registry

| Domain                     | Canonical / source                                                | Mapping rule                                          | Unresolved behavior                                              |
| -------------------------- | ----------------------------------------------------------------- | ----------------------------------------------------- | ---------------------------------------------------------------- |
| 医薬品 identity            | canonical DrugMaster YJ。source はレセ電、HOT、一般名、JAHIS code | namespaced exact code → approved ConceptMap → YJ      | `CODE_MAPPING_REVIEW_REQUIRED`。薬品名一致で resolved にしない。 |
| 包装・実物                 | GS1 GTIN / JAN → DrugPackage → DrugMaster/YJ                      | exact package mapping                                 | 複数候補、別 YJ、不正 GTIN は mismatch。                         |
| 用法・route・frequency     | JP Core package terminology + source-specific code                | adapter/version ごとの ConceptMap                     | free-text や近似一致で確定しない。                               |
| status                     | Resource ごとの FHIR status + source workflow status              | source/version ごとの明示表                           | 未知 status を requested status や completed へ既定化しない。    |
| JAHIS record               | 24-104 / 26-101 / 24-105 の versioned record contract             | adapter ごとに direction と Resource candidate を固定 | unknown version/record は quarantine。                           |
| practitioner qualification | canonical qualification registry                                  | Practitioner 表示情報とは別に verified/current を評価 | role 名や free-form credential で資格を成立させない。            |
| organization / facility    | source namespaced identifier                                      | exact identifier + tenant/source namespace            | 名称・住所だけの自動 link をしない。                             |

ConceptMap artifact は source system、source version、target code system、effective period、status、
reviewer、hash を持つ。`exact / unmapped / ambiguous / retired` を区別し、ambiguous を自動採用しない。
ConceptMap が未批准の source は native replica/owner commit へ進めない。

## 8. Identifier Namespace Registry

| Identifier key                  | Namespace rule                                                                  | Uniqueness / use                                                                          |
| ------------------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| canonical replica identity      | authoritative base URL + `resourceType` + logical `id` + `meta.versionId`       | immutable version の主キー。payload hash を同一 version の不一致検出へ加える。            |
| FHIR logical id                 | authoritative base URL 内の `resourceType + id` で scope                        | 異なる server の同じ `id` を同一視しない。business identity に使わない。                  |
| yrese patient                   | yrese が契約で供給する stable `identifier.system` + `value`                     | patient auto-link の第一候補。実 URI が未合意なら cutover しない。                        |
| official prescription           | 発行主体が定める namespaced prescription identifier                             | patient/source namespace と組み合わせる。文字列単独で tenant 横断検索しない。             |
| PH-OS patient / case / resource | org-scoped internal ID + public display ID                                      | internal ID を外部 FHIR identifier や URL に露出しない。external canonical URI は別批准。 |
| JAHIS payload / record          | adapter type + version + source organization + payload hash + source record key | idempotency/provenance 用。FHIR logical id や確定処方 ID に流用しない。                   |
| paper/fax/manual artifact       | FileAsset reference + content hash + capture source/time                        | OCR text、filename、presigned URL を identifier にしない。                                |
| event / delivery                | source event ID + schema version + payload hash + org/source                    | replay/idempotency 用。Resource identity と分ける。                                       |

氏名、生年月日、性別、住所、薬品名は照合 evidence にはできるが、自動 link の一意 key にしない。
identifier は `(org_id, external_system_id, system, value)` で評価し、value 単独の unique を作らない。

## 9. Adapter Registry

| Adapter                              | Version / authority                   | Direction                                      | Resource contract                                                                                           | Gate                                                                                     |
| ------------------------------------ | ------------------------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| yrese FHIR                           | FHIR R4 4.0.1 + JP Core 1.2.0         | bidirectional, owner-filtered FHIR sync        | yrese-owned Resource は PH-OS read-only replica、PH-OS-owned Resource は yrese read-only replica とする。   | signed/authenticated source、stable identifier、history、idempotency、profile validation |
| JAHIS electronic medication notebook | 24-104 Ver.2.6 / `JAHISTC08`          | inbound patient-held evidence; approved export | MedicationStatement/reconciliation minimum。条件付き MedicationDispense history。MedicationRequest は禁止。 | byte/record conformance、patient identity、source provenance、medical-information review |
| JAHIS outpatient prescription symbol | 26-101 Ver.1.11                       | inbound prescription candidate                 | MedicationRequest candidate + DocumentReference + Provenance                                                | printed original review、patient/prescription identifier、version contract               |
| JAHIS pharmacy internal exchange     | 24-105 Ver.1.1                        | direction-specific                             | yrese / approved edge adapter dataset                                                                       | direction、implementer、facility scope、conformance fixture                              |
| NSIPS                                | Ver.1.07.01                           | licensed edge only                             | yrese / licensed edge → versioned event/FHIR                                                                | membership/review、licensed specification access、implementer、facility scope            |
| national e-prescription              | MHLW ONS / guide 2.04 / checklist 4.2 | yrese Official Adapter only                    | yrese-owned MedicationRequest / MedicationDispense                                                          | official conformance、signature/auth、record condition、human release gate               |
| paper/fax/manual                     | source artifact + operator review     | inbound candidate                              | MedicationRequest candidate + DocumentReference + Provenance                                                | patient match、source hash、review attribution、no OCR auto-finalize                     |

PH-OS の現行 direct e-prescription fetch、provider `confirmDispense`、FHIR
`createMedicationDispense` は削除対象の migration inventory であり、target capability ではない。
cutover manifest は definition、caller、route、job、schema reader/writer を列挙し、すべて 0 にしてから
旧経路を同じ release で削除する。

## 10. Canonical Ingress and Bundle Contract

```text
source payload
  -> Adapter Envelope(source, format, version, license scope, correlation, payload hash)
  -> byte/count/type/signature/tenant/source identifier preflight
  -> patient identity candidate
  -> terminology + ConceptMap resolution
  -> FHIR Resource candidates + source DocumentReference
  -> pinned package/profile/terminology/reference validation
  -> quarantine/review OR authoritative immutable Resource Version + current head + search index
  -> transactional opaque Resource/version/hash outbox; no clinical payload copy
  -> owner-filtered FHIR sync + server-local Provenance/AuditEvent + Technical Control reference
```

Bundle rules:

- 受入可能な Bundle type は adapter/use-case ごとの allowlist で固定する。
- `transaction` / `batch` の受付は、原子性、partial failure、response、retry contract が批准されるまで禁止する。
- 全 `entry.resource` を resource/version 単位 work item にし、Bundle graph と commit marker を持つ。
- contained Resource、URN fullUrl、absolute/relative reference、循環、欠落参照を validator で検査する。
- bytes、entry count、reference depth、contained size、attachment size、timeout の批准済み上限がない endpoint は公開しない。
- 先頭 Resource だけを queue item に接続する現行挙動は converter 対象へ含め、hard cutover で削除する。
- raw payload、Resource 本文、患者 identifier を通常 log や queue error metadata に複製しない。

## 11. Validation and CapabilityStatement Contract

### 11.1 Validation stages

1. **Synchronous preflight**: payload size/type、JSON、resourceType、tenant/source identifier、
   signature/hash、profile allowlist、明白な patient mismatch。preflightは受付・quarantine振分けだけを行い、
   callerのrequested statusや`meta.profile`文字列から最終`valid`を付与しない。
2. **Full validation**: pinned FHIR/JP Core package、cardinality、slicing、invariant、binding、
   terminology、reference graph、批准済み Questionnaire canonical/version/hash。
3. **Business gates**: patient matching、duplicate、source authority、qualification、assignment、
   purpose、consent、OCC、SoD。標準 validator の成功で代替しない。
4. **Commit gate**: valid Resource/version と解決済み reference だけを authoritative current head、
   search index、history、outbox と同じ logical commit で確定する。

結果は `valid / invalid / unsupported_profile / terminology_review / identity_review /
reference_unresolved` を区別する。受信臨床情報を破棄せず quarantine し、PHI-safe diagnostic、
review、replay、package/terminology version を保持する。validator timeout や terminology service
unavailable を `valid` にしない。

現行`standard-clinical-fhir-validation.ts` / `src/server/adapters/fhir/index.ts`はconformance authorityに
流用しない。確認済みの不一致は次のとおり。

- FHIR JSONでprimitive値と`_element`配列の位置を揃えるため許可されるnull placeholderを、一律
  `FHIR_JSON_NULL_NOT_ALLOWED`として拒否する。
- JP Core Patient 1.2.0の`identifier 1..* / name 0..* / gender 0..1 / birthDate 0..1`に対し、
  name・gender・birthDateを必須にしながらidentifier空配列を許す。
- caller指定`valid`と期待`meta.profile`だけで最終validを返し得る。
- 外部validator issueを`EXTERNAL_VALIDATOR_ERRORS_REDACTED`一件へ潰し、severity、code、expression、
  validator/package fingerprintを失う。

replacement validatorのfixtureは、上記null placeholder、JP Core Patient cardinality、valid/invalid profile、
slicing/invariant/binding、terminology、reference、timeoutを含む。commit/quarantine結果にはPHIを含めず、
正規化したOperationOutcomeのseverity/code/expressionとvalidator、FHIR/JP Core/IG/terminology package digestを
再現可能なevidenceとして保持する。

### 11.2 CapabilityStatement draft

現在 `/fhir/r4/metadata` と FHIR REST endpoint は存在しないため、external capability は **none**。
hard cutover 時点の最低 capability は次を含み、Resource matrix の target interaction と一致させる。

| Scope                | Required interaction                                          | Contract                                                                                            |
| -------------------- | ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| yrese-owned replica  | read, vread, history, approved indexed search                 | PH-OS create/update/delete を拒否し、authoritative identity と version/hash を返す。                |
| PH-OS-owned Resource | read, vread, history, approved indexed search, create, update | owner-side validation、OCC、authorization、Consent、Provenance、AuditEvent、outbox を原子的に扱う。 |
| Bundle               | transaction                                                   | 全 entry の owner/authz/validation、conditional reference、原子性、OperationOutcome を実装する。    |
| cross-server change  | Subscription または批准済み history pull                      | owner-filter、cursor、retry、dedupe、correction/cancellation、gap reconciliation を実装する。       |
| system metadata      | capabilities                                                  | live route/profile/search/security から `CapabilityStatement` を生成する。                          |

search index、query budget、pagination、OAuth/scope、tenant/purpose/Consent、rate/payload limit、
audit、contract test がそろった interaction だけを registry から `CapabilityStatement` へ出す。
patch/delete/conditional create、batch、Bulk Export は個別批准まで宣言しない。UI はこの FHIR API を
dogfood し、旧 clinical API や UI 専用 clinical DTO を呼ばない。

## 12. Authorization, Consent, Audit, and PHI

- すべての read/write は明示 tenant に pin し、RLS + FORCE RLS、assignment、purpose、consent を評価する。
- 認可済み tenant の clinical/operational/audit data は `clerk` も全件閲覧できる。薬歴記載、
  報告書作成、監査実行だけは actor 本人の canonical verified/current 薬剤師資格 **and**
  tenant/assignment/purpose/SoD を満たす場合だけ許可する。owner/admin 等の role 名で代替しない。
- read、execute、govern/oversight、assign、notification recipient、external output を別 capability にする。
- supporter は明示 assignment tenant の read-only。break-glass でも supporter identity を write へ昇格しない。
- Patient/clinical Resource 本文の read は purpose と PHI read audit を残す。export、print、external share、
  offline carry は read と別の approval/audit/retention gate を通す。
- Provenance は Resource/version の生成・変換・送信元を表す。AuditEvent/internal AuditLog は access、
  search、output、authz decision を表す。同じ event として潰さない。
- audit changes、server/client log、URL、metric、Oracle/GPT prompt に raw Resource、raw JAHIS、
  患者 identifier、添付、全面 diff を入れない。

## 13. Source Artifact, Retention, and Offline

- canonical Resource、raw adapter payload、source document、workflow metadata は別 retention と別 access policy にする。
- FHIR REST 内で本文を管理する場合は `resourceType = Binary` とし、`contentType`、`securityContext`、
  authorized reference、malicious/malformed content 検査を必須にする。Binary は search 対象にしない。
  外部暗号化 object body は FHIR Resource ではなく Source Artifact であり、Resource Inventory に
  pseudo resource として登録しない。
- `ClinicalFhirRawResourceVault` は schema と purge があるだけで writer/encrypt/decrypt/replay capability はない。
  既存 capability とみなさず、`FILE-LIFE-001` の quarantine/retention と接続する。
- vault を実装する場合は crypto/KMS、key rotation、step-up replay、legal hold、backup/restore、
  AWS/security/privacy review を必須にする。presigned/internal storage URL を Resource/cache/provenance に保存しない。
- offline FHIR/clinical data は現在未承認。将来実装では encryption、TTL、device/session binding、
  manifest/hash、purpose/consent、remote revoke、local audit、復旧時の profile/terminology/patient/reference
  revalidation と conflict review を必須にする。
- TTL、暗号化、remote revoke、lost-device 手順、clock skew test のいずれかがない offline carry を禁止する。

## 14. Deterministic Conversion, Hard Cutover, and Recovery

本計画は runtime の並行運用を行わない。移行前の旧 release と、移行後の FHIR Native release の
間に writable な中間状態を作らず、次の一方向手順で完全置換する。

1. repository URL、exact source commit SHA、branch、dirty manifest、build artifact digestを固定したうえで、
   SELECT-only inventory で全 legacy table/column/route/job/caller/DTO と row count、tenant count、
   referential anomaly、unresolved identifier、source version を manifest 化する。
2. 同一 frozen input と pinned converter/version/package/terminology から同一 Resource identity、
   semantic payload、hash、Provenance を生成する deterministic converter を実装する。legacy の欠損・
   invalid value を必須 element の捏造で埋めない。migration profileは親FHIR/JP Core profileの制約を
   緩和してはならず、適用可能なdata-absent-reasonだけを使う。Resource自体が誤りの場合だけ
   entered-in-errorを使い、それ以外はsource preservation + Provenance付きexception/quarantineへ分類する。
   exceptionをJP Core準拠Resourceとして表示せず、承認者・理由・source hashを残す。
3. production snapshot の read-only copy に対して dry run を繰り返し、Resource/version count、owner、
   reference graph、terminology、patient link、approved exception、quarantine、semantic digest を全件照合する。
   `unexpected quarantine = 0`、unaccounted row 0、critical clinical diff 0 を要求するが、承認済み exception
   自体を 0 とするために値を捏造しない。
4. DB/FHIR store と immutable history、search rebuild source、object/document/raw-vault reference、audit
   chain、terminology/IG/validator packageとdigest、encryption key availability、adapter watermark、
   queue/cursor、converter manifest、FHIR `Attachment.hash`のSHA-1とは独立したobject SHA-256 manifestを
   一つの署名付きencrypted recovery setとして取得・復元するrehearsalを行う。RTO/RPO、key owner、
   search rebuild parity、担当者、停止条件を含むevidenceを人間が承認する。
5. yrese sandbox の `CapabilityStatement`、批准済み IG/package hash、identifier namespace、owner matrix、
   transaction、history、Subscription、OperationOutcome、認証/認可を PH-OS contract test と相互照合する。
   yrese producer/consumer と PH-OS/yrese UI/adapter consumer の release readiness が揃わず、custom webhook
   だけで接続している場合は go/no-go を deny する。PH-OS 単独では cutover しない。
6. write freeze 前に cutover epoch と yrese/JAHIS/eRx/manual/offline ごとの source watermark を発行する。
   全clinical writerとingressに加え、全clinical outbound/export/Subscription deliveryをepochでfenceし、
   queue/outboxをdrainする。adapterごとのack/replay境界をsigned manifestへ記録する。fence中のpayloadは、
   許諾・retention を満たす場合だけ encrypted Adapter-plane `RawIngressEnvelope` として durable hold し、
   それ以外は upstream retry を要求する。late pre-epoch write は reject し、offline client は新 epoch へ
   rebase する。queue drain だけを ingress 停止証跡にしない。
7. 旧 release を停止し、freeze 後 delta と全 source watermark を manifest と照合してから承認済み
   converter を一度だけ実行する。unexpected quarantine 0、unaccounted row 0、critical diff 0、approved
   exception ledger parity を満たすまで新 release を公開しない。
8. FHIR Native schema/server/UI/Official Adapter を含む単一 release を起動し、held envelope と late ingress
   は最新 profile/terminology/identity/Consent で再検証した後、新 FHIR server だけへ replay する。FHIR
   REST、transaction、history、Subscription、CapabilityStatement、authorization、双方 UI dogfood、yrese
   sync smoke と zero old process/route/job/schema traffic を確認する。ここでは write freeze を解除しない。
9. 人間の最終 go/no-go 後にcutover epochをcommitし、全source/consumerを新epochへ切り替える。
   append-only accepted-write journalとrecovery replayを先に有効化し、解除後にacknowledgeしたclinical
   writeのRPO=0を実証してからwrite freezeを解除する。RPO=0を満たせない場合は定量化したRPOと患者安全影響を
   medical/privacy/operationsが明示承認するまで解除しない。この瞬間を **irreversible commit point** とする。
10. irreversible commit point 前の abort は部分切替で行わない。新 release 全体を停止し、承認済み旧
    release と cutover 直前 recovery set を一体で restore する。
11. irreversible commit point 後は新規 FHIR write を失う旧 release/snapshot rollback を禁止する。
    FHIR Native recovery set + append-only Resource history/accepted-write journal/ingress journal replay、
    またはforward-fixで回復する。部分schema rollback、FHIR dataだけの削除、旧writerと新writerの
    同時起動は禁止する。

schema/migration/DML apply、production snapshot/dry run/conversion、write freeze、hard cutover、restore、
legacy drop、destructive cleanup は個別 human gate とする。dry run は read-only snapshot 上の比較であり、
production request を二系統へ流す運用ではない。

## 15. Round-trip and Acceptance Matrix

最低限の fixture / test:

- official JP Core 1.2.0 examples + PHI-free synthetic boundary fixtures
- valid/invalid profile、Injection/non-Injection、FHIR primitive / `_element`配列のnull placeholder、
  JP Core Patient cardinality、slicing、invariant、binding
- ConceptMap exact/unmapped/ambiguous/retired、薬品名だけの候補、source version mismatch
- Bundle all-entry、entry order、duplicate delivery、out-of-order version、partial failure、missing/cyclic reference
- patient stable identifier、missing/multiple candidate、demographic-only mismatch、cross-tenant
- DetectedIssue は review candidate として保持し、相手所有 MedicationRequest / MedicationDispense を自動変更しない
- QuestionnaireResponse は批准済み Questionnaire canonical/version/hash へ exact 解決し、unknown/stale reference を quarantine する
- historical missing/invalid required data は親FHIR/JP Core制約を緩和しないapproved migration profile、
  適用可能なdata-absent-reason、Resource自体が誤りの場合のentered-in-error、またはsource-preserving
  exception ledgerへ入り、必須値を捏造せずexceptionをJP Core準拠と表示しない
- serialize → validate → persist version → read → serialize の semantic round-trip
- JAHIS canonical Shift-JIS bytes / record round-trip と独立 decoder
- outbox/queue idempotency、claim/retry/dead-letter、search-index rebuild、OCC/current-head race
- role × qualification × purpose × consent、clerk read、pharmacist-only execution、supporter assignment
- PHI omission in log/error/metric/audit changes、raw vault access、retention/legal hold
- deterministic converter repeatability、source SHA/dirty/build manifest、full reconciliation、write-freeze delta 0、
  approved exception parity、unexpected quarantine 0、cutover epoch/source watermark、全ingress/outbound/export/
  Subscription fence、late ingress reject/hold/replay、adapter ack/replay
- recovery set restore、FHIR history/search rebuild、object/raw-vault reference、audit chain、package/key、
  queue/cursor/watermark parity、Attachment SHA-1 + object manifest SHA-256、append-only accepted-write/ingress
  journal replay、post-unfreeze RPO=0、zero old process/route/job/schema reader/writer telemetry
- yrese CapabilityStatement/IG/package/identifier/transaction/history/Subscription sandbox parity、
  producer/consumer readiness、PH-OS/yrese UI dogfood
- CapabilityStatement と actual route/profile/search/security の parity

JSON object key order は意味比較から除外してよいが、FHIR array を blanket sort しない。
serializer は unknown field/extension を黙って削除せず、approved preservation または quarantine を選ぶ。
hash canonicalization は algorithm/version を保存し、変更時に過去 hash を再解釈しない。

## 16. Stop Gates and Human Gates

次のいずれかが未確定なら native schema/API implementation または hard cutover へ進まない。

- FHIR release / JP Core package / profile canonical
- yrese SoR と source-specific write owner
- CareTeam owner/profile/identifier/replica direction
- repository exact commit/dirty/build manifest と再現可能な source baseline
- stable patient / prescription identifier namespace
- drug、dosage、status の ConceptMap と ambiguity policy
- JAHIS/NSIPS/e-prescription の version、license、implementer、direction、facility scope
- validator package/terminology snapshot、quarantine/replay、reference policy
- validator authority、OperationOutcome severity/code/expression、FHIR/JP Core/IG/terminology/validator fingerprint
- tenant/purpose/consent、qualification、read/write/output audit
- source artifact retention、legal hold、encryption/key rotation
- DocumentReference/Binary ownership、object access、Attachment SHA-1 + manifest SHA-256
- Bundle/payload/search budget
- yrese sandbox CapabilityStatement/IG/package/identifier/transaction/history/Subscription parity と
  producer/consumer release readiness
- cutover epoch、全 ingress/outbound/export/Subscription fence、source watermark、encrypted hold/upstream retry、
  late write/replay、adapter ack/replay、signed cutover/recovery manifest
- converter repeatability threshold、critical diff 0、full reconciliation、write-freeze drain、
  approved exception parity、unexpected quarantine 0、full recovery-set restore rehearsal、RTO/RPO、
  irreversible commit point
- migration profile非緩和、data-absent-reason / entered-in-error / exceptionの適用境界
- accepted-write journal、write-unfreeze後RPO=0、または定量化RPOと患者安全影響の明示承認

以下は常に個別 human gate とする。

- schema/migration/DML apply
- production inventory/recovery-set snapshot/dry run/conversion/mutation
- e-prescription connection、NSIPS application/implementation、external send
- Bulk Export、third-party Subscription、offline PHI carry
- ingress fence/write freeze、single hard cutover、pre-commit whole-release recovery-set abort、
  post-commit FHIR-native recovery、legacy drop、destructive cleanup

## 17. Current Live Evidence

- `prisma/schema/standard-clinical-integration.prisma`: Resource enum、cache、raw vault、event、outbox、queue、provenance の現行 schema
- `src/server/services/standard-clinical-integration-import.ts`: generic Resource cache と `importedResources[0]` queue coupling
- `src/server/services/standard-clinical-fhir-validation.ts` / `src/server/adapters/fhir/index.ts`: 4 Resourceの
  手書きprofile/shape preflight。FHIR null placeholder、JP Core Patient cardinality、caller requested valid、
  external issue normalizationに確認済みconformance gapがあり、replacement対象
- `src/server/adapters/fhir/index.ts`: FHIR R4/JP Core version literals、normalizer、direct MedicationDispense create
- `src/server/adapters/e-prescription/index.ts`: direct fetch / confirm adapter capability
- `src/app/api/patients/[id]/prescriptions/e-prescription/route.ts`: direct e-prescription intake path
- `src/app/api/qr-scan-drafts/[id]/confirm/route.ts`: JAHIS QR → legacy intake confirmation path
- `docs/drug-code-master-architecture.md`: namespaced code identity、exact mapping、review-required policy
- `docs/security/phi-read-audit-design.md`: PHI read audit boundary

この P0 task は v0.5 contract と実行 task graph の文書化だけを行う。source code、schema、migration、
runtime endpoint、external connection、production data は変更しない。

## 18. Execution Child Task Graph

`Plans.md` の 10 個の `FHIR-NATIVE-*` parent を、次の PR-sized child task に分解する。A は
Foundation / Legacy inventory、B は Conformance / PH-OS Server、C は PH-OS Server / Adapter /
yrese replica、D は yrese sync、E は conversion / cutover / UI / post-core ecosystem に対応する。child は
`Plans.md` へ ownership と status が登録されて初めて active implementation task になる。
依存 task の exit gate を満たさずに後続へ進まず、schema apply、external send、production data、
cutover は child 内のコードが完成しても個別 human gate を維持する。

この27行は依存関係の全履歴である。A0/A1は2026-07-15に完了し、完了証跡はmachine-readable
registryと`ops/refactor/STATE.md`へ移したため、unfinished-onlyの`Plans.md` active child tableには
残さない。active依存では完了済みA0/A1を除去し、A2/A3/A5を次の実行可能入口とする。

| Wave | Child task                                     | Depends on     | Deliverable / exit gate                                                                                                                                                                                                                                                                                                               |
| ---- | ---------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A0   | `FHIR-NATIVE-P0-FOUNDATION-001-DOCS`           | none           | v0.5の版、3 plane、source baseline、Resource owner/interaction/profile/search/retention/access、Bundle、validation、hard-cutover contractとtask graphをSSOTとして確定する。CareTeamはowner/profile批准までUNRESOLVEDとし、未批准値をdefaultで埋めない。                                                                               |
| A1   | `FHIR-NATIVE-P0-FOUNDATION-002-RATCHET`        | A0             | exact source SHA/dirty/build manifest、package lock/digest、Resource matrix、registry、Capability contractをmachine-readableにし、docs/code/live route差分をCIでfail-closedにする。runtime/schemaは変えない。                                                                                                                         |
| A2   | `FHIR-NATIVE-LEGACY-MIGRATION-001-INVENTORY`   | A0             | 旧 schema/table/column、direct e-prescription、`createMedicationDispense`、route/job/caller/DTO を SELECT-only manifest に固定し、cutover gate を zero reader/writer/caller で fail-closed にする。削除対象外へ分類する場合は owner review を必須にする。                                                                             |
| A3   | `FHIR-NATIVE-P0-FOUNDATION-003-RAW-INGRESS`    | A0, A1         | server-only `RawIngressEnvelope`、source/trust 合法組合せ、version/hash/idempotency/payload-limit、encrypted cutover hold、epoch/watermark/replay contract を typed decision table と PHI-free fixture で固定する。通常 persistence/API は追加しない。                                                                                |
| A4   | `FHIR-NATIVE-PHOS-SERVER-001-BUNDLE-PREFLIGHT` | A1, A3         | bounded Bundle parser が全 entry を Resource/version work item と reference graph へ変換し、duplicate fullUrl、missing/cyclic reference、unsupported type、budget 超過を quarantine decision にする。DB write は行わない。                                                                                                            |
| A5   | `FHIR-NATIVE-P0-FOUNDATION-004-CONFORMANCE`    | A0, A1         | FHIR R4、JP Core 1.2.0、StructureDefinition、ValueSet、CodeSystem、ConceptMap、Questionnaire の canonical/version/hash と source provenance を pin する。runtime network fallback と unversioned artifact を禁止する。                                                                                                                |
| B1   | `FHIR-NATIVE-CONFORMANCE-001-VALIDATOR`        | A5             | official JP Core examplesとPHI-free negative fixtureに加え、FHIR null placeholder、JP Core Patient cardinality、OperationOutcome severity/code/expression、validator/package fingerprintで標準validator、package resolution、timeout、cache key、throughputを比較し採否を記録する。dependency追加はreview後だけ。                     |
| B2   | `FHIR-NATIVE-CONFORMANCE-002-TERMINOLOGY`      | A5             | HOT/YJ/レセ電/一般名/用法/status の namespaced exact mapping と `exact / unmapped / ambiguous / retired` を実装し、名称・近似一致による確定を拒否する。                                                                                                                                                                               |
| B3   | `FHIR-NATIVE-CONFORMANCE-003-RUNTIME`          | A4, B1, B2     | selected validator、terminology、reference graph、QuestionnaireをFHIR commit gateへ接続する。local preflight/external requested statusは`valid`を付与できず、invalid/timeout/unavailableは正規化OperationOutcomeとfingerprint付きPHI-safe quarantineへ送る。                                                                          |
| B4   | `FHIR-NATIVE-PHOS-SERVER-002-SCHEMA`           | A1, A3, B3     | immutable Resource Version、history/current head、reference graph、search rebuild source、raw/object reference、RLS + FORCE RLS の replacement schema/migration と full recovery-set restore 手順を作る。DB review 前に apply しない。                                                                                                |
| B5   | `FHIR-NATIVE-PHOS-SERVER-003-COMMIT`           | approved B4    | owner-side version/current-head/search/Provenance/AuditEvent と opaque Resource/version/hash outbox を原子的に commit する。OCC/idempotency/race を検証し、raw/clinical payload、URL、custom event DTO を Control Plane へ複製しない。                                                                                                |
| B6   | `FHIR-NATIVE-PHOS-SERVER-004-SEARCH`           | B5             | §5 の approved SearchParameter だけを tenant-scoped index へ接続し、pagination、query/payload budget、query plan、rebuild parity を検証する。scan/filter fallback を禁止する。                                                                                                                                                        |
| C1   | `FHIR-NATIVE-PHOS-SERVER-005-BUNDLE-COMMIT`    | A4, B5         | `importedResources[0]` coupling を全 entry の transaction commit graph へ置換し、原子性、idempotency、retry、OperationOutcome を正しく実装する。                                                                                                                                                                                      |
| C2   | `FHIR-NATIVE-PHOS-SERVER-006-PATIENT-LINKAGE`  | B3, B5         | source-namespaced stable identifier を第一条件に patient link を解決し、missing/multiple/collision/demographic-only/cross-tenant を review に送る。氏名・生年月日だけで自動 link しない。                                                                                                                                             |
| C3   | `FHIR-NATIVE-YRESE-SYNC-001-REPLICA`           | B6, C1, C2     | yrese-owned Resource を canonical identity 付き read-only replica として history/Subscription から同期し、duplicate/order 逆転/correction/cancellation/RLS/AuditEvent/Provenance を検証する。                                                                                                                                         |
| C4   | `FHIR-NATIVE-ADAPTER-PLANE-001-JAHIS-SPLIT`    | A3, B3         | transport decoder と 24-104 electronic medication notebook / 26-101 prescription symbol adapter を別 ID・version・mapping・commit rule に分離し、golden/version-reject/byte-record fixture を通す。                                                                                                                                   |
| C5   | `FHIR-NATIVE-ADAPTER-PLANE-002-NOTEBOOK`       | B5, C2, C4     | JAHISTC08 を MedicationStatement / reconciliation evidence first で commit し、批准済み条件だけ MedicationDispense history を許す。MedicationRequest 生成件数を常に 0 とする。                                                                                                                                                        |
| D1   | `FHIR-NATIVE-YRESE-SYNC-002-PHOS-OWNED`        | A1, B3, B5     | PH-OS-owned Resource と version-specific Provenance を owner-side FHIR commit から送信可能な Bundle にし、resource owner deny fixture を通す。external send はしない。                                                                                                                                                                |
| D2   | `FHIR-NATIVE-YRESE-SYNC-003-OUTBOX-ACK`        | B5, D1         | Resource commit と opaque reference-only `YreseOutboundEvent` を同一 transaction にし、version/hash、delivery state、attempt/cursor、ack/conflict/loop suppression を atomic に記録する。臨床payloadは送信時にFHIR storeからBundle化し、eventへ保存しない。                                                                           |
| D3   | `FHIR-NATIVE-YRESE-SYNC-004-RECONCILE`         | B6, D2         | yrese sandbox CapabilityStatement/IG/package/identifier/transaction/history/Subscription parity、双方consumer readiness、signed delivery、history gap reconciliation を証明する。custom webhookだけの接続を拒否し、production sendはhuman gateとする。                                                                                |
| E1   | `FHIR-NATIVE-LEGACY-MIGRATION-002-CONVERTER`   | C3, C5, D3     | deterministic converter、親profile非緩和missing/invalid policy、SELECT-only dry run、source manifest、semantic digest、approved exception/unexpected quarantine/full reconciliation、cutover epoch/source watermark planを実装する。production dataはhuman gate。                                                                     |
| E2   | `FHIR-NATIVE-CUTOVER-001-HARD-CUTOVER`         | E1, E3, E4, E5 | signed full recovery-set rehearsal、all-ingress/outbound/export/Subscription epoch fence、hold/retry/ack/replay、single conversion、FHIR/yrese/UI smoke、accepted-write journal、post-unfreeze RPO=0、irreversible commit point、pre-commit whole-release abort、post-commit native recoveryを証明する。cutover/cleanupはhuman gate。 |
| E3   | `FHIR-NATIVE-UI-DOGFOOD-001-CLINICAL-UX`       | C3, C5, E4     | PH-OS UI を同じ FHIR Data Plane へ接続し、「処方を取り込む」と「お薬情報を取り込む」、authority、validation、薬剤師 review、claimability、sync version を文言 + icon で表示する。旧 clinical API caller を 0 にする。                                                                                                                 |
| E4   | `FHIR-NATIVE-PHOS-SERVER-007-FHIR-REST`        | B3, B6         | read/vread/history/search/create/update と profile/search/security だけから CapabilityStatement を生成し、OAuth/scope、tenant/purpose/Consent、pagination、rate/payload limit、audit と actual route parity を通す。                                                                                                                  |
| E5   | `FHIR-NATIVE-PHOS-SERVER-008-TRANSACTION`      | A4, B5, E4     | approved use-case の transaction Bundle を受け、全 entry authz/owner/validation、原子性、OperationOutcome、retry contract を実装する。batch/patch/delete は個別批准まで宣言しない。                                                                                                                                                   |
| E6   | `FHIR-NATIVE-OFFLINE-EDGE-001-FOUNDATION`      | D3, E1, E4     | offline Visit Bundle と批准済み NSIPS edge を、暗号化、TTL、device/session binding、manifest/hash、revoke、local audit、復旧時 revalidation/rebase 付きで実装する。実装・PHI carry は human gate とする。                                                                                                                             |
| E7   | `FHIR-NATIVE-OPEN-ECOSYSTEM-001-FOUNDATION`    | E2, E4, E5     | core cutover 後に SMART on FHIR、Bulk Data、Partner Sandbox/SDK、CDS Hooks を別 task へ分解し、実装済み Capability だけを公開する。external enable/export は human gate とする。                                                                                                                                                      |

implementation order は `A0 -> A1/A2 -> A3/A5 -> A4/B1/B2 -> B3 -> B4/B5/B6 -> C/D -> E1/E3/E4/E5 -> E2 -> E6/E7`
とする。`B4` は DB、`D3` は external send、`E1/E2` は production data/cutover、`E6/E7` は
offline/external ecosystem の human gate を解除しない。複数 gate を一つの PR へ混ぜず、同じ parent
prefix で child を追加する。
