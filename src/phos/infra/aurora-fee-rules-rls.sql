CREATE TABLE IF NOT EXISTS phos_fee_rule_master (
  tenant_id text NOT NULL,
  rule_id text NOT NULL,
  fee_code text NOT NULL,
  fee_label text NOT NULL,
  tenant_scope text NOT NULL CHECK (tenant_scope IN ('SYSTEM', 'TENANT')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, rule_id)
);

CREATE TABLE IF NOT EXISTS phos_fee_rule_versions (
  tenant_id text NOT NULL,
  rule_version_id text NOT NULL,
  rule_id text NOT NULL,
  revision_code text NOT NULL,
  active_from date NOT NULL,
  active_to date,
  active boolean NOT NULL DEFAULT true,
  condition jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, rule_version_id),
  FOREIGN KEY (tenant_id, rule_id) REFERENCES phos_fee_rule_master (tenant_id, rule_id)
);

CREATE TABLE IF NOT EXISTS phos_fee_rule_evidence_requirements (
  tenant_id text NOT NULL,
  rule_version_id text NOT NULL,
  evidence_key text NOT NULL,
  label text NOT NULL,
  required boolean NOT NULL,
  source_kind text NOT NULL,
  display_order integer NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, rule_version_id, evidence_key),
  FOREIGN KEY (tenant_id, rule_version_id)
    REFERENCES phos_fee_rule_versions (tenant_id, rule_version_id)
);

CREATE TABLE IF NOT EXISTS phos_fee_rule_source_refs (
  tenant_id text NOT NULL,
  rule_version_id text NOT NULL,
  ref_id text NOT NULL,
  kind text NOT NULL,
  label text NOT NULL,
  uri text,
  captured_at timestamptz,
  display_order integer NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, rule_version_id, ref_id),
  FOREIGN KEY (tenant_id, rule_version_id)
    REFERENCES phos_fee_rule_versions (tenant_id, rule_version_id)
);

CREATE INDEX IF NOT EXISTS phos_fee_rule_master_tenant_fee_idx
  ON phos_fee_rule_master (tenant_id, fee_code, tenant_scope);
CREATE INDEX IF NOT EXISTS phos_fee_rule_versions_active_order_idx
  ON phos_fee_rule_versions (tenant_id, rule_id, active, revision_code DESC, rule_version_id);
CREATE INDEX IF NOT EXISTS phos_fee_rule_evidence_requirements_order_idx
  ON phos_fee_rule_evidence_requirements (tenant_id, rule_version_id, display_order, evidence_key);
CREATE INDEX IF NOT EXISTS phos_fee_rule_source_refs_order_idx
  ON phos_fee_rule_source_refs (tenant_id, rule_version_id, display_order, ref_id);

ALTER TABLE phos_fee_rule_master ENABLE ROW LEVEL SECURITY;
ALTER TABLE phos_fee_rule_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE phos_fee_rule_evidence_requirements ENABLE ROW LEVEL SECURITY;
ALTER TABLE phos_fee_rule_source_refs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS phos_fee_rule_master_tenant_isolation ON phos_fee_rule_master;
DROP POLICY IF EXISTS phos_fee_rule_master_tenant_select ON phos_fee_rule_master;
DROP POLICY IF EXISTS phos_fee_rule_master_tenant_insert ON phos_fee_rule_master;
DROP POLICY IF EXISTS phos_fee_rule_master_tenant_update ON phos_fee_rule_master;
DROP POLICY IF EXISTS phos_fee_rule_master_tenant_delete ON phos_fee_rule_master;
CREATE POLICY phos_fee_rule_master_tenant_select ON phos_fee_rule_master
  FOR SELECT
  USING (
    tenant_id = current_setting('app.tenant_id', true)
    OR (tenant_scope = 'SYSTEM' AND tenant_id = 'SYSTEM')
  );
CREATE POLICY phos_fee_rule_master_tenant_insert ON phos_fee_rule_master
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true) AND tenant_scope = 'TENANT');
CREATE POLICY phos_fee_rule_master_tenant_update ON phos_fee_rule_master
  FOR UPDATE
  USING (tenant_id = current_setting('app.tenant_id', true) AND tenant_scope = 'TENANT')
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true) AND tenant_scope = 'TENANT');
CREATE POLICY phos_fee_rule_master_tenant_delete ON phos_fee_rule_master
  FOR DELETE
  USING (tenant_id = current_setting('app.tenant_id', true) AND tenant_scope = 'TENANT');

DROP POLICY IF EXISTS phos_fee_rule_versions_tenant_isolation ON phos_fee_rule_versions;
DROP POLICY IF EXISTS phos_fee_rule_versions_tenant_select ON phos_fee_rule_versions;
DROP POLICY IF EXISTS phos_fee_rule_versions_tenant_insert ON phos_fee_rule_versions;
DROP POLICY IF EXISTS phos_fee_rule_versions_tenant_update ON phos_fee_rule_versions;
DROP POLICY IF EXISTS phos_fee_rule_versions_tenant_delete ON phos_fee_rule_versions;
CREATE POLICY phos_fee_rule_versions_tenant_select ON phos_fee_rule_versions
  FOR SELECT
  USING (tenant_id = current_setting('app.tenant_id', true) OR tenant_id = 'SYSTEM');
CREATE POLICY phos_fee_rule_versions_tenant_insert ON phos_fee_rule_versions
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
CREATE POLICY phos_fee_rule_versions_tenant_update ON phos_fee_rule_versions
  FOR UPDATE
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
CREATE POLICY phos_fee_rule_versions_tenant_delete ON phos_fee_rule_versions
  FOR DELETE
  USING (tenant_id = current_setting('app.tenant_id', true));

DROP POLICY IF EXISTS phos_fee_rule_evidence_requirements_tenant_isolation
  ON phos_fee_rule_evidence_requirements;
DROP POLICY IF EXISTS phos_fee_rule_evidence_requirements_tenant_select
  ON phos_fee_rule_evidence_requirements;
DROP POLICY IF EXISTS phos_fee_rule_evidence_requirements_tenant_insert
  ON phos_fee_rule_evidence_requirements;
DROP POLICY IF EXISTS phos_fee_rule_evidence_requirements_tenant_update
  ON phos_fee_rule_evidence_requirements;
DROP POLICY IF EXISTS phos_fee_rule_evidence_requirements_tenant_delete
  ON phos_fee_rule_evidence_requirements;
CREATE POLICY phos_fee_rule_evidence_requirements_tenant_select
  ON phos_fee_rule_evidence_requirements
  FOR SELECT
  USING (tenant_id = current_setting('app.tenant_id', true) OR tenant_id = 'SYSTEM');
CREATE POLICY phos_fee_rule_evidence_requirements_tenant_insert
  ON phos_fee_rule_evidence_requirements
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
CREATE POLICY phos_fee_rule_evidence_requirements_tenant_update
  ON phos_fee_rule_evidence_requirements
  FOR UPDATE
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
CREATE POLICY phos_fee_rule_evidence_requirements_tenant_delete
  ON phos_fee_rule_evidence_requirements
  FOR DELETE
  USING (tenant_id = current_setting('app.tenant_id', true));

DROP POLICY IF EXISTS phos_fee_rule_source_refs_tenant_isolation ON phos_fee_rule_source_refs;
DROP POLICY IF EXISTS phos_fee_rule_source_refs_tenant_select ON phos_fee_rule_source_refs;
DROP POLICY IF EXISTS phos_fee_rule_source_refs_tenant_insert ON phos_fee_rule_source_refs;
DROP POLICY IF EXISTS phos_fee_rule_source_refs_tenant_update ON phos_fee_rule_source_refs;
DROP POLICY IF EXISTS phos_fee_rule_source_refs_tenant_delete ON phos_fee_rule_source_refs;
CREATE POLICY phos_fee_rule_source_refs_tenant_select ON phos_fee_rule_source_refs
  FOR SELECT
  USING (tenant_id = current_setting('app.tenant_id', true) OR tenant_id = 'SYSTEM');
CREATE POLICY phos_fee_rule_source_refs_tenant_insert ON phos_fee_rule_source_refs
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
CREATE POLICY phos_fee_rule_source_refs_tenant_update ON phos_fee_rule_source_refs
  FOR UPDATE
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
CREATE POLICY phos_fee_rule_source_refs_tenant_delete ON phos_fee_rule_source_refs
  FOR DELETE
  USING (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE phos_fee_rule_master FORCE ROW LEVEL SECURITY;
ALTER TABLE phos_fee_rule_versions FORCE ROW LEVEL SECURITY;
ALTER TABLE phos_fee_rule_evidence_requirements FORCE ROW LEVEL SECURITY;
ALTER TABLE phos_fee_rule_source_refs FORCE ROW LEVEL SECURITY;
