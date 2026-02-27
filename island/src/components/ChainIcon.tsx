interface ChainIconProps {
  chain: string;
  className?: string;
  size?: number;
}

export function getChainLabel(chain: string): string {
  if (chain === "base") return "Base";
  if (chain === "ethereum") return "Ethereum";
  return "Solana";
}

export default function ChainIcon({ chain, className, size = 12 }: ChainIconProps) {
  const box = {
    width: `${size}px`,
    height: `${size}px`,
    minWidth: `${size}px`,
    minHeight: `${size}px`,
    maxWidth: `${size}px`,
    maxHeight: `${size}px`,
    flex: `0 0 ${size}px`,
  } as const;

  if (chain === "base") {
    return (
      <span
        className={className}
        aria-hidden="true"
        style={{
          ...box,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
          borderRadius: "0.18em",
          lineHeight: 0,
        }}
      >
        <img
          src={`${import.meta.env.BASE_URL}base.svg`}
          alt=""
          style={{
            width: "100%",
            height: "100%",
            display: "block",
            objectFit: "contain",
          }}
        />
      </span>
    );
  }

  if (chain === "ethereum") {
    return (
      <svg
        viewBox="0 0 24 24"
        className={className}
        aria-hidden="true"
        style={box}
      >
        <path
          d="M12 2.3 6.7 12l5.3 3.2 5.3-3.2L12 2.3Zm-5.3 11.7L12 21.7l5.3-7.7L12 17.2 6.7 14Z"
          fill="currentColor"
        />
      </svg>
    );
  }
  if (chain === "solana") {
    return (
      <svg
        viewBox="0 0 24 24"
        className={className}
        aria-hidden="true"
        style={box}
      >
        <path
          d="M5.2 5.5a1.8 1.8 0 0 1 1.3-.5h11.2c1.2 0 1.8 1.5.9 2.4l-2.2 2.2a1.8 1.8 0 0 1-1.3.5H4c-1.2 0-1.8-1.5-.9-2.4l2.1-2.2Z"
          fill="currentColor"
        />
        <path
          d="M18.8 11.8a1.8 1.8 0 0 0-1.3-.5H6.3c-1.2 0-1.8 1.5-.9 2.4l2.2 2.2c.3.3.8.5 1.3.5h11.2c1.2 0 1.8-1.5.9-2.4l-2.2-2.2Z"
          fill="currentColor"
          opacity="0.82"
        />
        <path
          d="M5.2 18.1a1.8 1.8 0 0 1 1.3-.5h11.2c1.2 0 1.8 1.5.9 2.4l-2.2 2.2a1.8 1.8 0 0 1-1.3.5H4c-1.2 0-1.8-1.5-.9-2.4l2.1-2.2Z"
          fill="currentColor"
          opacity="0.66"
        />
      </svg>
    );
  }
  return null;
}
