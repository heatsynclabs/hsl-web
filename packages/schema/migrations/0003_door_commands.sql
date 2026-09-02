CREATE TABLE "door_commands" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"command" text NOT NULL,
	"requested_by_id" text,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolution" text
);
--> statement-breakpoint
ALTER TABLE "door_commands" ADD CONSTRAINT "door_commands_requested_by_id_user_id_fk" FOREIGN KEY ("requested_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "door_commands_waiting_idx" ON "door_commands" USING btree ("resolved_at","requested_at");