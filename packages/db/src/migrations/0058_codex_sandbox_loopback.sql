ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "codex_sandbox_loopback_enabled" boolean DEFAULT true NOT NULL;
