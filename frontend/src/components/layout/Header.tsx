import { usePrivy } from "@privy-io/react-auth";
import { Palmtree } from "lucide-react";
import { Link } from "react-router-dom";
import { useProfile } from "../../contexts/ProfileContext";
import { useXProfile } from "../../hooks/useXProfile";

// const links = [{ to: "/", label: "Home", icon: House }];

export function Header() {
  return (
    <header className="sticky top-0 z-30 border-b border-jungle-700/60 bg-jungle-950/85 backdrop-blur">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-2 px-3 py-2.5 sm:px-4 sm:py-3 md:px-6">
        <Link
          to="/"
          className="flex items-center gap-1.5 font-display font-semibold text-zinc-100 sm:gap-2"
        >
          <Palmtree className="h-5 w-5 shrink-0 text-heat-observer" />
          <span className="text-base sm:text-lg">Memetics</span>
        </Link>
        {/* <nav className="hidden items-center gap-2 md:flex">
          {links.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end
              className={({ isActive }) =>
                `inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${
                  isActive
                    ? "bg-jungle-700 text-zinc-100"
                    : "text-zinc-300 hover:bg-jungle-800"
                }`
              }
            >
              <Icon className="h-4 w-4" />
              {label}
            </NavLink>
          ))}
        </nav> */}
        <ProfileButton />
      </div>
    </header>
  );
}

function ProfileButton() {
  const { ready, authenticated, login } = usePrivy();
  const { profile, isLoading, isReady } = useProfile();
  const xProfile = useXProfile();

  if (!authenticated) {
    return (
      <button
        type="button"
        onClick={login}
        disabled={!ready}
        className="shrink-0 rounded-lg bg-heat-observer px-3 py-2 text-sm font-medium text-jungle-950 disabled:opacity-60"
      >
        Sign in
      </button>
    );
  }

  // Loading state
  if (isLoading || !isReady) {
    return (
      <div className="flex items-center gap-2">
        <div className="h-8 w-8 animate-pulse rounded-full bg-jungle-700" />
      </div>
    );
  }

  // Use Farcaster data if available, fall back to X profile from Privy
  const pfpUrl = profile?.farcaster?.pfp_url || xProfile?.profilePictureUrl;
  const username = profile?.farcaster?.username || xProfile?.username;

  return (
    <Link
      to="/profile"
      className="flex shrink-0 items-center gap-2 rounded-lg border border-jungle-600 p-1 pr-1 text-sm text-zinc-100 transition-colors hover:bg-jungle-800 sm:px-2 sm:py-1.5 sm:pr-3"
    >
      <img
        src={pfpUrl || "https://placehold.co/32x32/0d2118/ffffff?text=?"}
        alt={username || "Profile"}
        className="h-8 w-8 rounded-full border border-jungle-600 object-cover"
      />
      <span className="hidden text-zinc-200 sm:inline">
        {username ? `@${username}` : "Profile"}
      </span>
    </Link>
  );
}
