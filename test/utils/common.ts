import { createAnvil } from "@viem/anvil";
import { createPublicClient, http, createWalletClient, createTestClient } from "viem";
import { foundry } from "viem/chains";

const BLOCK_RESET_FORK = 18665818n;
const RPC_RESET_FORK = 'https://eth.llamarpc.com'

export const anvil = createAnvil({ stopTimeout: 5000 });
export const anvilFork = createAnvil({ stopTimeout: 5000, forkBlockNumber: BLOCK_RESET_FORK, forkUrl: RPC_RESET_FORK, forkChainId: 31337 });
export const publicClient = createPublicClient({ chain: foundry, transport: http() });
export const walletClient = createWalletClient({ chain: foundry, transport: http() });
export const testClient = createTestClient({ chain: foundry, mode: "anvil", transport: http() });