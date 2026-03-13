import { describe, expect, test } from "bun:test";
import { encodeAbiParameters, encodeEventTopics, type Log, type TransactionReceipt } from "viem";
import bodegaAbiJson from "../../../contracts/current/abi/Bodega.json";
import commissionManagerAbiJson from "../../../contracts/current/abi/CommissionManager.json";
import islandIdentityAbiJson from "../../../contracts/current/abi/IslandIdentity.json";
import jungleBayIslandAbiJson from "../../../contracts/current/abi/JungleBayIsland.json";
import {
  buildLinkWalletSignature,
  buildRegisterSignature,
  canonicalizeAssetIdentifier,
  collectReceiptEffects,
  computeAssetKey,
  getInitialBackfillStartBlock,
  isCaseInsensitiveChain,
  ONCHAIN_CONTRACTS,
} from "./onchain";

const islandIdentityAbi = islandIdentityAbiJson as readonly any[];
const jungleBayIslandAbi = jungleBayIslandAbiJson as readonly any[];
const bodegaAbi = bodegaAbiJson as readonly any[];
const commissionManagerAbi = commissionManagerAbiJson as readonly any[];

function createLog(input: {
  address: `0x${string}`;
  abi: readonly any[];
  eventName: string;
  args: Record<string, unknown>;
  nonIndexed: Array<{ type: string; value: unknown }>;
  logIndex: number;
  txHash: `0x${string}`;
}): Log {
  const topics = encodeEventTopics({
    abi: input.abi,
    eventName: input.eventName,
    args: input.args,
  });

  return {
    address: input.address,
    blockHash: "0x1",
    blockNumber: 123n,
    data: encodeAbiParameters(
      input.nonIndexed.map((entry) => ({ type: entry.type })),
      input.nonIndexed.map((entry) => entry.value),
    ),
    logIndex: input.logIndex,
    removed: false,
    topics,
    transactionHash: input.txHash,
    transactionIndex: 0,
  } as Log;
}

describe("onchain helpers", () => {
  test("canonicalizes only case-insensitive chains", () => {
    expect(isCaseInsensitiveChain("BASE")).toBe(true);
    expect(isCaseInsensitiveChain("solana")).toBe(false);
    expect(canonicalizeAssetIdentifier("base", "0xAbC123")).toBe("0xabc123");
    expect(canonicalizeAssetIdentifier("solana", "AbC123")).toBe("AbC123");
  });

  test("computes the same asset key for equivalent EVM addresses", () => {
    const a = computeAssetKey({ chain: "base", tokenAddress: "0xAbC123" });
    const b = computeAssetKey({ chain: "BASE", tokenAddress: "0xabc123" });
    expect(a).toBe(b);
  });

  test("builds register and link-wallet signatures with current contract domains", async () => {
    const session = {
      privyUserId: "did:privy:test",
      xUserId: 123456789n,
      xHandle: "@jbi",
      authorizedWallets: ["0x1111111111111111111111111111111111111111"],
      profileId: 9,
      profile: {
        profile_id: 9,
        x_user_id: "123456789",
        x_handle: "jbi",
        main_wallet: "0x1111111111111111111111111111111111111111",
        created_at_unix: 1,
        updated_at_unix: 1,
        hardcore_warning: false,
        wallets: ["0x1111111111111111111111111111111111111111"],
      },
      walletCluster: null,
      aggregatedHeat: 42,
      tier: "observer",
    };

    const register = await buildRegisterSignature({
      wallet: "0x1111111111111111111111111111111111111111",
      session,
    });
    expect(register.contract_address).toBe(ONCHAIN_CONTRACTS.islandIdentity);
    expect(register.x_handle).toBe("jbi");
    expect(register.sig.startsWith("0x")).toBe(true);

    const link = await buildLinkWalletSignature({
      wallet: "0x1111111111111111111111111111111111111111",
      session,
    });
    expect(link.contract_address).toBe(ONCHAIN_CONTRACTS.islandIdentity);
    expect(link.profile_id).toBe(9);
    expect(link.sig.startsWith("0x")).toBe(true);
  });

  test("collects receipt effects from all four contracts", () => {
    const txHash = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const receipt = {
      blockNumber: 123n,
      transactionHash: txHash,
      transactionIndex: 0,
      status: "success",
      logs: [
        createLog({
          address: ONCHAIN_CONTRACTS.islandIdentity,
          abi: islandIdentityAbi,
          eventName: "ProfileRegistered",
          args: {
            profileId: 1n,
            xUserId: 9n,
          },
          nonIndexed: [
            { type: "string", value: "jbi" },
            { type: "address", value: "0x1111111111111111111111111111111111111111" },
          ],
          logIndex: 0,
          txHash,
        }),
        createLog({
          address: ONCHAIN_CONTRACTS.jungleBayIsland,
          abi: jungleBayIslandAbi,
          eventName: "BungalowMinted",
          args: {
            tokenId: 7n,
            owner: "0x1111111111111111111111111111111111111111",
          },
          nonIndexed: [
            { type: "string", value: "base" },
            { type: "string", value: "0xabc" },
            { type: "uint256", value: 1000000n },
          ],
          logIndex: 1,
          txHash,
        }),
        createLog({
          address: ONCHAIN_CONTRACTS.bodega,
          abi: bodegaAbi,
          eventName: "ItemInstalled",
          args: {
            itemId: 11n,
            bungalowId: 7n,
            installerProfileId: 1n,
          },
          nonIndexed: [{ type: "uint256", value: 0n }],
          logIndex: 2,
          txHash,
        }),
        createLog({
          address: ONCHAIN_CONTRACTS.commissionManager,
          abi: commissionManagerAbi,
          eventName: "CommissionApproved",
          args: {
            commissionId: 13n,
            artistProfileId: 1n,
          },
          nonIndexed: [
            { type: "uint256", value: 92000000n },
            { type: "uint256", value: 11n },
          ],
          logIndex: 3,
          txHash,
        }),
      ],
    } as unknown as TransactionReceipt;

    const effects = collectReceiptEffects(receipt, {
      blockTimestampUnix: 1_710_000_000,
    });
    expect(effects.profileIds).toContain(1);
    expect(effects.bungalowIds).toContain(7);
    expect(effects.itemIds).toContain(11);
    expect(effects.commissionIds).toContain(13);
    expect(effects.commissionItemIds.get(13)).toBe(11);
    expect(effects.installs[0]?.installedAtUnix).toBe(1_710_000_000);
  });

  test("uses the deployment block as the initial backfill floor", () => {
    expect(getInitialBackfillStartBlock()).toBe(43_303_971n);
  });
});
