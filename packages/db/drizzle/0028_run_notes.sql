ALTER TABLE "run_schedules" ADD COLUMN "skip_reason" text;--> statement-breakpoint
ALTER TABLE "run_schedules" ADD COLUMN "skipped_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "note" text;