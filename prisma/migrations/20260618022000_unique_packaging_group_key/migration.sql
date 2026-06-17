DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "PackagingGroup"
    GROUP BY "org_id", "cycle_id", "group_key"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot add PackagingGroup(org_id, cycle_id, group_key) unique index: duplicate group_key rows exist';
  END IF;
END $$;

CREATE UNIQUE INDEX "PackagingGroup_org_id_cycle_id_group_key_key"
ON "PackagingGroup"("org_id", "cycle_id", "group_key");
