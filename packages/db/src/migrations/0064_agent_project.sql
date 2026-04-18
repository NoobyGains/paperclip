ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "project_id" uuid
  REFERENCES "projects"("id") ON DELETE SET NULL;
