CREATE TABLE IF NOT EXISTS "user_profiles" (
  "user_id" text PRIMARY KEY NOT NULL,
  "subscription_only" boolean DEFAULT true NOT NULL,
  "claude_subscription" text,
  "codex_subscription" text,
  "preferences" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
