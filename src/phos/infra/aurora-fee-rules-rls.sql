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

ALTER TABLE phos_fee_rule_master ENABLE ROW LEVEL SECURITY;
ALTER TABLE phos_fee_rule_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE phos_fee_rule_evidence_requirements ENABLE ROW LEVEL SECURITY;
ALTER TABLE phos_fee_rule_source_refs ENABLE ROW LEVEL SECURITY;

CREATE POLICY phos_fee_rule_master_tenant_isolation ON phos_fee_rule_master
  USING (
    tenant_id = current_setting('app.tenant_id', true)
    OR (tenant_scope = 'SYSTEM' AND tenant_id = 'SYSTEM')
  )
  WITH CHECK (
    tenant_id = current_setting('app.tenant_id', true)
    OR (tenant_scope = 'SYSTEM' AND tenant_id = 'SYSTEM')
  );

CREATE POLICY phos_fee_rule_versions_tenant_isolation ON phos_fee_rule_versions
  USING (tenant_id = current_setting('app.tenant_id', true) OR tenant_id = 'SYSTEM')
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true) OR tenant_id = 'SYSTEM');

CREATE POLICY phos_fee_rule_evidence_requirements_tenant_isolation
  ON phos_fee_rule_evidence_requirements
  USING (tenant_id = current_setting('app.tenant_id', true) OR tenant_id = 'SYSTEM')
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true) OR tenant_id = 'SYSTEM');

CREATE POLICY phos_fee_rule_source_refs_tenant_isolation ON phos_fee_rule_source_refs
  USING (tenant_id = current_setting('app.tenant_id', true) OR tenant_id = 'SYSTEM')
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true) OR tenant_id = 'SYSTEM');
