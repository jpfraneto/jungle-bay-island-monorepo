import type { FarcasterProfile } from '../../lib/types';

export function FarcasterAvatar({ profile }: { profile: FarcasterProfile }) {
  return (
    <div className="inline-flex items-center gap-2">
      <img
        src={profile.pfp_url || 'https://placehold.co/64x64/0d2118/ffffff?text=FC'}
        alt={profile.username}
        className="h-7 w-7 rounded-full border border-jungle-700 object-cover"
      />
      <span className="text-sm text-zinc-100">@{profile.username}</span>
    </div>
  );
}
