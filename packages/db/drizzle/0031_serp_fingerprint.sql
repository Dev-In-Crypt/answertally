ALTER TABLE "responses" ADD COLUMN "serp_domains" text[];--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "excluded_reads" integer DEFAULT 0 NOT NULL;