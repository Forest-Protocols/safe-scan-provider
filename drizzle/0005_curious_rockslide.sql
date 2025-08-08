CREATE TABLE "virtual_provider_offer_configurations" (
	"id" integer PRIMARY KEY NOT NULL,
	"configuration" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"pt_address_id" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "config" ALTER COLUMN "key" SET DATA TYPE varchar(300);--> statement-breakpoint
ALTER TABLE "protocols" ALTER COLUMN "address" SET DATA TYPE citext;--> statement-breakpoint
ALTER TABLE "providers" ALTER COLUMN "owner_address" SET DATA TYPE citext;--> statement-breakpoint
ALTER TABLE "resources" ALTER COLUMN "owner_address" SET DATA TYPE citext;--> statement-breakpoint
ALTER TABLE "providers" ADD COLUMN "is_virtual" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "providers" ADD COLUMN "gateway_provider_id" integer;--> statement-breakpoint
ALTER TABLE "resources" ADD COLUMN "created_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "virtual_provider_offer_configurations" ADD CONSTRAINT "virtual_provider_offer_configurations_pt_address_id_protocols_id_fk" FOREIGN KEY ("pt_address_id") REFERENCES "public"."protocols"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "providers" ADD CONSTRAINT "providers_gateway_provider_id_providers_id_fk" FOREIGN KEY ("gateway_provider_id") REFERENCES "public"."providers"("id") ON DELETE no action ON UPDATE no action;