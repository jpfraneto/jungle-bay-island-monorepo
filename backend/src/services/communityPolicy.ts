export const COMMUNITY_POLICY = {
  bungalow_submit_min_heat: 25,
  bungalow_support_min_heat: 50,
  bungalow_single_builder_min_heat: 65,
  bungalow_steward_min_heat: 80,
  bungalow_required_supporters: 5,
  bungalow_construction_fee_jbm: 420_000n,
  jbac_shortcut_min_balance: 10n,
  jbac_shortcut_chain: "ethereum",
  jbac_shortcut_token_address: "0xd37264c71e9af940e49795f0d3a8336afaafdda9",
} as const;

export type ConstructionQualificationPath =
  | "single_hot_wallet"
  | "community_support"
  | "jbac_shortcut";

export function getConstructionQualification(input: {
  islandHeat: number;
  supportCount: number;
  jbacBalance: bigint;
}): ConstructionQualificationPath | null {
  if (input.islandHeat >= COMMUNITY_POLICY.bungalow_single_builder_min_heat) {
    return "single_hot_wallet";
  }

  if (input.jbacBalance >= COMMUNITY_POLICY.jbac_shortcut_min_balance) {
    return "jbac_shortcut";
  }

  if (
    input.supportCount >= COMMUNITY_POLICY.bungalow_required_supporters &&
    input.islandHeat >= COMMUNITY_POLICY.bungalow_support_min_heat
  ) {
    return "community_support";
  }

  return null;
}
