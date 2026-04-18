ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "auto_hire_enabled" boolean DEFAULT false NOT NULL;
