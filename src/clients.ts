import { createPublicClient } from "viem";
import { config } from "./config";
import { forestChainToViemChain, httpTransport } from "@forest-protocols/sdk";
import { abortController } from "./signal";

export const rpcClient = createPublicClient({
  chain: forestChainToViemChain(config.CHAIN),
  transport: httpTransport(
    config.CHAIN,
    config.RPC_HOST,
    abortController.signal
  ),
});
