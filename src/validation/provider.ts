import { AddressSchema, PrivateKeySchema } from "@forest-protocols/sdk";
import { z } from "zod";

export const ProviderConfigSchema = z.object({
  PROVIDER_PRIVATE_KEY: PrivateKeySchema,
  BILLING_PRIVATE_KEY: PrivateKeySchema,
  OPERATOR_PRIVATE_KEY: PrivateKeySchema,
  OPERATOR_PIPE_PORT: z.coerce.number().positive(),
  PROTOCOL_ADDRESS: AddressSchema.optional(),
  GATEWAY: z.boolean().default(false),
});

export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;
