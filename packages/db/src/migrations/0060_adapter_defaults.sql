ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "default_hire_adapter" text;
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "default_reviewer_agent_id" uuid REFERENCES "agents"("id") ON DELETE SET NULL;
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "auto_review_enabled" boolean DEFAULT false NOT NULL;
