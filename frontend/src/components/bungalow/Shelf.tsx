import { useCallback, useState } from 'react';
import { Globe, MessageCircle, Send, Twitter, BarChart3, Pencil, Check, X } from 'lucide-react';
import type { ExternalLinks } from '../../lib/types';

const itemMeta = [
  { key: 'x', label: 'X', icon: Twitter, dbKey: 'link_x' },
  { key: 'farcaster', label: 'Farcaster', icon: MessageCircle, dbKey: 'link_farcaster' },
  { key: 'telegram', label: 'Telegram', icon: Send, dbKey: 'link_telegram' },
  { key: 'website', label: 'Website', icon: Globe, dbKey: 'link_website' },
  { key: 'dexscreener', label: 'DexScreener', icon: BarChart3, dbKey: null },
] as const;

interface ShelfProps {
  links?: ExternalLinks;
  canEdit?: boolean;
  onSaveLinks?: (links: Record<string, string | null>) => void | Promise<void>;
}

function EditableLinkBadge({
  href,
  label,
  icon: Icon,
  dbKey,
  onSave,
}: {
  href?: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  dbKey: string;
  onSave: (links: Record<string, string | null>) => void | Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(href || '');
  const [saving, setSaving] = useState(false);

  const handleSave = useCallback(async () => {
    const trimmed = draft.trim();
    if (trimmed === (href || '')) {
      setEditing(false);
      return;
    }
    if (trimmed && !/^https?:\/\//i.test(trimmed)) {
      return;
    }
    setSaving(true);
    try {
      await onSave({ [dbKey]: trimmed || null });
    } finally {
      setSaving(false);
      setEditing(false);
    }
  }, [draft, href, dbKey, onSave]);

  const handleCancel = useCallback(() => {
    setDraft(href || '');
    setEditing(false);
  }, [href]);

  if (editing) {
    return (
      <div className="col-span-full flex items-center gap-2">
        <Icon className="h-4 w-4 flex-shrink-0 text-zinc-400" />
        <input
          autoFocus
          type="url"
          value={draft}
          placeholder={`https://...`}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void handleSave();
            if (e.key === 'Escape') handleCancel();
          }}
          className="flex-1 rounded-lg border border-heat-observer/40 bg-jungle-900 px-2 py-1.5 text-sm text-zinc-200 outline-none focus:border-heat-observer"
          disabled={saving}
        />
        <button type="button" onClick={() => void handleSave()} className="text-heat-resident hover:text-heat-builder" disabled={saving}>
          <Check className="h-4 w-4" />
        </button>
        <button type="button" onClick={handleCancel} className="text-zinc-400 hover:text-zinc-200">
          <X className="h-4 w-4" />
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className={`group rounded-lg border px-3 py-2 text-left text-sm ${
        href
          ? 'border-jungle-700 text-zinc-200 hover:bg-jungle-800'
          : 'border-dashed border-jungle-700 text-zinc-500 hover:border-zinc-500 hover:bg-jungle-900/50'
      }`}
    >
      <span className="inline-flex items-center gap-2">
        <Icon className="h-4 w-4" />
        {label}
        <Pencil className="h-3 w-3 text-zinc-500 opacity-0 transition-opacity group-hover:opacity-100" />
      </span>
    </button>
  );
}

export function Shelf({ links, canEdit = false, onSaveLinks }: ShelfProps) {
  const safeLinks = links || {};

  return (
    <section className="card space-y-3">
      <div className="text-xs uppercase tracking-[0.18em] text-zinc-400">04 - The Shelf</div>
      <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-5">
        {itemMeta.map((item) => {
          const href = safeLinks[item.key];
          const Icon = item.icon;

          if (canEdit && onSaveLinks && item.dbKey) {
            return (
              <EditableLinkBadge
                key={item.key}
                href={href}
                label={item.label}
                icon={Icon}
                dbKey={item.dbKey}
                onSave={onSaveLinks}
              />
            );
          }

          return (
            <a
              key={item.key}
              href={href || '#'}
              target="_blank"
              rel="noreferrer"
              className={`rounded-lg border px-3 py-2 text-sm ${
                href
                  ? 'border-jungle-700 text-zinc-200 hover:bg-jungle-800'
                  : 'cursor-not-allowed border-jungle-800 text-zinc-500'
              }`}
              onClick={(event) => {
                if (!href) event.preventDefault();
              }}
            >
              <span className="inline-flex items-center gap-2">
                <Icon className="h-4 w-4" />
                {item.label}
              </span>
            </a>
          );
        })}
      </div>
    </section>
  );
}
