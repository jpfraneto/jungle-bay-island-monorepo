import { useState } from 'react';
import { ImagePlus, Send } from 'lucide-react';
import { useBulletin } from '../../hooks/useBulletin';
import { ActivityFeed } from '../common/ActivityFeed';
import { formatApiError } from '../../lib/apiError';
import type { ViewerContext } from '../../lib/types';

interface Props {
  chain: string;
  ca: string;
  viewerContext?: ViewerContext;
}

export function BulletinBoard({ chain, ca, viewerContext }: Props) {
  const { bulletinQuery, createPost } = useBulletin(chain, ca);
  const [content, setContent] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [showImageInput, setShowImageInput] = useState(false);

  const posts = bulletinQuery.data?.posts ?? [];
  const total = bulletinQuery.data?.total ?? 0;
  const isAuthenticated = Boolean(viewerContext);
  const canPost = isAuthenticated;

  const handleSubmit = async () => {
    if (!content.trim()) return;
    await createPost.mutateAsync({
      content: content.trim(),
      image_url: imageUrl.trim() || undefined,
    });
    setContent('');
    setImageUrl('');
    setShowImageInput(false);
  };

  return (
    <section className="card space-y-5">
      <div className="flex items-center justify-between">
        <div className="text-xs uppercase tracking-[0.18em] text-zinc-400">
          03 - The Bulletin Board
        </div>
        <span className="text-xs text-zinc-500">{total} post{total !== 1 ? 's' : ''}</span>
      </div>

      {canPost && (
        <div className="space-y-3 rounded-lg border border-jungle-700 bg-jungle-900/40 p-4">
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Share something with the community..."
            maxLength={280}
            rows={2}
            className="w-full resize-none rounded-md border border-jungle-700 bg-jungle-950/80 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:border-jungle-500 focus:outline-none"
          />
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowImageInput(!showImageInput)}
                className="inline-flex items-center gap-1 rounded-md border border-jungle-700 px-2 py-1 text-xs text-zinc-400 hover:bg-jungle-800"
              >
                <ImagePlus className="h-3.5 w-3.5" />
                Image
              </button>
              <span className="text-xs text-zinc-500">{content.length}/280</span>
            </div>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!content.trim() || createPost.isPending}
              className="inline-flex items-center gap-1.5 rounded-md bg-jungle-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-jungle-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Send className="h-3.5 w-3.5" />
              {createPost.isPending ? 'Posting...' : 'Post'}
            </button>
          </div>
          {showImageInput && (
            <input
              type="url"
              value={imageUrl}
              onChange={(e) => setImageUrl(e.target.value)}
              placeholder="https://example.com/image.png"
              className="w-full rounded-md border border-jungle-700 bg-jungle-950/80 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:border-jungle-500 focus:outline-none"
            />
          )}
          {createPost.isError && (
            <p className="text-xs text-red-400">{formatApiError(createPost.error)}</p>
          )}
        </div>
      )}

      {!isAuthenticated && (
        <p className="text-xs text-zinc-500">
          Connect your wallet to post on the bulletin board.
        </p>
      )}

      {posts.length === 0 && (
        <p className="text-sm text-zinc-500">No posts yet. Be the first to share something.</p>
      )}

      <ActivityFeed posts={posts} showBungalowLink={false} />
    </section>
  );
}
