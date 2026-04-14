ALTER TABLE "InquiryRecord"
ADD COLUMN "proposal_origin" TEXT,
ADD COLUMN "residual_adjustment" BOOLEAN DEFAULT false;
