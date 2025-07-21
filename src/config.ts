import { z } from "zod";
import { red } from "ansis";
import {
  addressSchema,
  ForestRegistryAddress,
  getContractAddressByChain,
  PrivateKeySchema,
  setGlobalRateLimit,
  setGlobalRateLimitTimeWindow,
} from "@forest-protocols/sdk";
import { nonEmptyStringSchema } from "./validation/schemas";
import { Address } from "viem";
import dotenv from "@dotenvx/dotenvx";
import { parseTime } from "./utils/parse-time";

function parseEnv() {
  const environmentSchema = z.object({
    DATABASE_URL: nonEmptyStringSchema,
    LOG_LEVEL: z.enum(["error", "warning", "info", "debug"]).default("debug"),
    NODE_ENV: z.enum(["dev", "production"]).default("dev"),
    RPC_HOST: nonEmptyStringSchema,
    CHAIN: z
      .enum(["anvil", "optimism", "optimism-sepolia", "base", "base-sepolia"])
      .default("anvil"),
    PORT: z.coerce.number().default(3000),
    RATE_LIMIT: z.coerce.number().default(20),
    RATE_LIMIT_WINDOW: z
      .string()
      .default("1s")
      .transform((value, ctx) => parseTime(value, ctx)),
    REGISTRY_ADDRESS: addressSchema.optional(),
    INDEXER_ENDPOINT: z.string().url().optional(),
    AGREEMENT_CHECK_INTERVAL: z
      .string()
      .default("5s")
      .transform((value, ctx) => parseTime(value, ctx)),
    AGREEMENT_BALANCE_CHECK_INTERVAL: z
      .string()
      .default("5m")
      .transform((value, ctx) => parseTime(value, ctx)),
    HTTP_PIPE_PORT_OFFSET: z.coerce.number().default(1352),
  });
  const parsedEnv = environmentSchema.safeParse(process.env, {});

  if (parsedEnv.error) {
    const error = parsedEnv.error.errors[0];
    console.error(
      red(
        `Error while parsing environment variable "${error.path}": ${error.message}`
      )
    );
    process.exit(1);
  }

  // Set global rate limit based on the given value (or default)
  setGlobalRateLimit(parsedEnv.data.RATE_LIMIT);
  setGlobalRateLimitTimeWindow(parsedEnv.data.RATE_LIMIT_WINDOW);

  return parsedEnv.data;
}

function parseProviderConfig() {
  const providerSchema = z.object({
    providerWalletPrivateKey: PrivateKeySchema,
    billingWalletPrivateKey: PrivateKeySchema,
    operatorWalletPrivateKey: PrivateKeySchema,
    protocolAddress: addressSchema.optional(),
  });

  const providers: {
    [providerTag: string]: z.infer<typeof providerSchema>;
  } = {};

  const pkRegex = /^(PROVIDER|BILLING|OPERATOR)_PRIVATE_KEY_([\w]+)$/;
  const ptAddressRegex = /^PROTOCOL_ADDRESS_([\w]+)$/;
  for (const [name, value] of Object.entries(process.env)) {
    const match = name.match(pkRegex);
    if (match) {
      const keyType = match[1];
      const providerTag = match[2];

      if (!providers[providerTag]) {
        providers[providerTag] = {
          billingWalletPrivateKey: "0x",
          operatorWalletPrivateKey: "0x",
          providerWalletPrivateKey: "0x",
        };
      }

      switch (keyType) {
        case "PROVIDER":
          providers[providerTag].providerWalletPrivateKey = value as Address;
          break;
        case "OPERATOR":
          providers[providerTag].operatorWalletPrivateKey = value as Address;
          break;
        case "BILLING":
          providers[providerTag].billingWalletPrivateKey = value as Address;
          break;
      }
    } else {
      const ptMatch = name.match(ptAddressRegex);
      if (ptMatch) {
        const providerTag = ptMatch[1];

        if (!providers[providerTag]) {
          providers[providerTag] = {
            billingWalletPrivateKey: "0x",
            operatorWalletPrivateKey: "0x",
            providerWalletPrivateKey: "0x",
          };
        }

        providers[providerTag].protocolAddress = value as Address;
      }
    }
  }

  for (const [providerTag, keys] of Object.entries(providers)) {
    const validation = providerSchema.safeParse(keys);

    if (validation.error) {
      const error = validation.error.errors[0];
      console.error(
        red(
          `Invalid Provider configuration for tag "${providerTag}": ${error.path}: ${error.message}`
        )
      );
      process.exit(1);
    }
  }
  return providers;
}

// Load the env file if there is one.
// Ignore the error if the file is not found.
dotenv.config({ ignore: ["MISSING_ENV_FILE"] });

const env = parseEnv();

export const config = {
  ...env,
  providers: parseProviderConfig(),
  registryAddress: getContractAddressByChain(env.CHAIN, ForestRegistryAddress),
};
