-- Enforce same-org template names as unique to avoid ambiguous template selection.
DROP INDEX IF EXISTS "FormularyTemplate_org_id_name_idx";
CREATE UNIQUE INDEX "FormularyTemplate_org_id_name_key"
  ON "FormularyTemplate"("org_id", "name");
