import { Link } from 'react-router-dom';
import { truncateAddress } from '../../lib/format';
import type { BulletinPost } from '../../lib/types';

interface Props {
  posts: BulletinPost[];
  showBungalowLink?: boolean;
}

/** Detect URLs in text and return segments of plain text and links */
function parseContentWithLinks(text: string): Array<{ type: 'text'; value: string } | { type: 'link'; href: string; display: string }> {
  const urlRegex = /(https?:\/\/[^\s<>)"']+)/g;
  const segments: Array<{ type: 'text'; value: string } | { type: 'link'; href: string; display: string }> = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = urlRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: 'text', value: text.slice(lastIndex, match.index) });
    }
    const href = match[1];
    let display: string;
    try {
      const u = new URL(href);
      display = u.hostname + (u.pathname !== '/' ? u.pathname.slice(0, 30) : '');
    } catch {
      display = href.slice(0, 40);
    }
    segments.push({ type: 'link', href, display });
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    segments.push({ type: 'text', value: text.slice(lastIndex) });
  }

  return segments;
}

function PostContent({ text }: { text: string }) {
  const segments = parseContentWithLinks(text);
  return (
    <p className="whitespace-pre-wrap text-sm text-zinc-200">
      {segments.map((seg, i) =>
        seg.type === 'link' ? (
          <a
            key={i}
            href={seg.href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-jungle-400 underline hover:text-jungle-300"
          >
            {seg.display}
          </a>
        ) : (
          <span key={i}>{seg.value}</span>
        ),
      )}
    </p>
  );
}

export function ActivityFeed({ posts, showBungalowLink = true }: Props) {
  if (posts.length === 0) {
    return (
      <p className="text-sm text-zinc-500">No activity yet.</p>
    );
  }

  return (
    <div className="space-y-4">
      {posts.map((post) => (
        <div key={post.id} className="space-y-2 rounded-lg border border-jungle-700/60 bg-jungle-900/30 p-4">
          {/* Header: poster + bungalow context */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              {post.poster_pfp && (
                <img
                  src={post.poster_pfp}
                  alt=""
                  className="h-5 w-5 rounded-full flex-shrink-0"
                />
              )}
              <span className="text-xs font-medium text-zinc-300 truncate">
                {post.poster_username ?? truncateAddress(post.wallet)}
              </span>
            </div>
            <span className="text-xs text-zinc-500 flex-shrink-0">
              {new Date(post.created_at).toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
              })}
            </span>
          </div>

          {/* Bungalow context */}
          {showBungalowLink && post.chain && post.token_address && (
            <Link
              to={`/${post.chain}/${post.token_address}`}
              className="flex items-center gap-2 rounded-md bg-jungle-900/60 px-2 py-1 text-xs hover:bg-jungle-800/60"
            >
              {post.bungalow_image_url ? (
                <img src={post.bungalow_image_url} alt="" className="h-4 w-4 rounded-full" />
              ) : (
                <span className="flex h-4 w-4 items-center justify-center rounded-full bg-jungle-700 text-[8px] font-bold text-jungle-300">
                  {(post.token_symbol ?? '?').slice(0, 2)}
                </span>
              )}
              <span className="text-zinc-400">
                {post.token_name ?? post.token_symbol ?? truncateAddress(post.token_address)}
              </span>
            </Link>
          )}

          {/* Content with URL detection */}
          <PostContent text={post.content} />

          {post.image_url && (
            <img
              src={post.image_url}
              alt=""
              className="max-h-48 rounded-md border border-jungle-700"
              loading="lazy"
            />
          )}
        </div>
      ))}
    </div>
  );
}
