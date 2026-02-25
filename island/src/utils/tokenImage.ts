export function getFallbackTokenImage(seedInput: string): string {
  const seed = encodeURIComponent(seedInput || "jungle-bay-token");
  return `https://api.dicebear.com/9.x/shapes/svg?seed=${seed}&backgroundColor=1f3b28,274c34,1a2f24`;
}

export function getTokenImageUrl(
  imageUrl: string | null | undefined,
  tokenAddress: string,
  symbol: string | null | undefined,
): string {
  if (imageUrl && imageUrl.trim().length > 0) {
    return imageUrl;
  }
  return getFallbackTokenImage(tokenAddress || symbol || "jungle-bay-token");
}
