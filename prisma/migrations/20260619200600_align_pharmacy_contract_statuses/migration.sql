DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PharmacyContractStatus') THEN
    IF EXISTS (
      SELECT 1
      FROM pg_enum enum_values
      JOIN pg_type enum_type ON enum_type.oid = enum_values.enumtypid
      WHERE enum_type.typname = 'PharmacyContractStatus'
        AND enum_values.enumlabel = 'ended'
    ) AND NOT EXISTS (
      SELECT 1
      FROM pg_enum enum_values
      JOIN pg_type enum_type ON enum_type.oid = enum_values.enumtypid
      WHERE enum_type.typname = 'PharmacyContractStatus'
        AND enum_values.enumlabel = 'terminated'
    ) THEN
      ALTER TYPE "PharmacyContractStatus" RENAME VALUE 'ended' TO 'terminated';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM pg_enum enum_values
      JOIN pg_type enum_type ON enum_type.oid = enum_values.enumtypid
      WHERE enum_type.typname = 'PharmacyContractStatus'
        AND enum_values.enumlabel = 'archived'
    ) AND NOT EXISTS (
      SELECT 1
      FROM pg_enum enum_values
      JOIN pg_type enum_type ON enum_type.oid = enum_values.enumtypid
      WHERE enum_type.typname = 'PharmacyContractStatus'
        AND enum_values.enumlabel = 'expired'
    ) THEN
      ALTER TYPE "PharmacyContractStatus" RENAME VALUE 'archived' TO 'expired';
    END IF;
  END IF;
END $$;
