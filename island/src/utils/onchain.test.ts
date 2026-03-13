import { describe, expect, test } from "bun:test";
import { formatUsdcAmount, normalizeTxError, ONCHAIN_CONTRACTS, parseUsdcRaw } from "./onchain";

describe("onchain frontend helpers", () => {
  test("loads canonical contract addresses without fallback", () => {
    expect(ONCHAIN_CONTRACTS.chainId).toBe(8453);
    expect(ONCHAIN_CONTRACTS.islandIdentity.startsWith("0x")).toBe(true);
    expect(ONCHAIN_CONTRACTS.jungleBayIsland.startsWith("0x")).toBe(true);
    expect(ONCHAIN_CONTRACTS.bodega.startsWith("0x")).toBe(true);
    expect(ONCHAIN_CONTRACTS.commissionManager.startsWith("0x")).toBe(true);
  });

  test("formats USDC values from raw 6-decimal units", () => {
    expect(formatUsdcAmount("1500000")).toBe("1.5");
    expect(formatUsdcAmount(0n)).toBe("0");
  });

  test("parses raw 6-decimal USDC values without rescaling", () => {
    expect(parseUsdcRaw("1500000")).toBe(1_500_000n);
    expect(parseUsdcRaw(0n)).toBe(0n);
  });

  test("normalizes common wallet rejection errors", () => {
    expect(normalizeTxError(new Error("User rejected the request."), "fallback")).toBe(
      "Transaction rejected in wallet.",
    );
    expect(normalizeTxError(new Error("boom"), "fallback")).toBe("boom");
    expect(normalizeTxError(null, "fallback")).toBe("fallback");
  });
});
