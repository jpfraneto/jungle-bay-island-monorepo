import { useCallback, useState } from 'react';
import { BadgeCheck, ShieldCheck, Share2, Check } from 'lucide-react';
import type { Bungalow } from '../../lib/types';
import { formatNumber } from '../../lib/format';
import { EditableText } from '../common/EditableText';

interface ThresholdProps {
  bungalow: Bungalow;
  canEdit?: boolean;
  onSaveDescription?: (value: string) => void | Promise<void>;
  chain?: string;
  ca?: string;
}

export function Threshold({ bungalow, canEdit = false, onSaveDescription, chain, ca }: ThresholdProps) {
  const [copied, setCopied] = useState(false);
  const defaultLine = `A Base ERC-20 token with ${formatNumber(bungalow.vitals?.holder_count || 0)} holders`;

  const handleShare = useCallback(() => {
    if (!chain || !ca) return;
    const url = `${window.location.origin}/b/${chain}/${ca}`;
    void navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [chain, ca]);

  return (
    <section className="card space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-xs uppercase tracking-[0.18em] text-zinc-400">01 - The Threshold</div>
        {chain && ca && (
          <button
            type="button"
            onClick={handleShare}
            className="inline-flex items-center gap-1.5 rounded-lg border border-jungle-700 px-2.5 py-1 text-xs text-zinc-300 transition-colors hover:bg-jungle-800"
          >
            {copied ? <Check className="h-3 w-3 text-heat-resident" /> : <Share2 className="h-3 w-3" />}
            {copied ? 'Copied!' : 'Share'}
          </button>
        )}
      </div>
      <div className="flex items-start gap-5">
        {bungalow.image_url && (
          <img
            src={bungalow.image_url}
            alt={bungalow.token_name}
            className="h-20 w-20 flex-shrink-0 rounded-xl border-2 border-jungle-700 object-cover"
          />
        )}
        <div>
          <h1 className="font-display text-4xl font-semibold leading-tight md:text-5xl">{bungalow.token_name}</h1>
          <p className="mt-1 font-mono text-lg text-zinc-300">${bungalow.token_symbol}</p>
        </div>
      </div>
      <div className="max-w-2xl text-sm text-zinc-300">
        {canEdit && onSaveDescription ? (
          <EditableText
            value={bungalow.description || ''}
            placeholder={defaultLine}
            canEdit={canEdit}
            onSave={onSaveDescription}
            maxLength={500}
          />
        ) : (
          <p>{bungalow.description || defaultLine}</p>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {bungalow.claimed && (
          <span className="inline-flex items-center gap-1 rounded-full border border-heat-observer/40 bg-heat-observer/15 px-2 py-1 text-heat-observer">
            <BadgeCheck className="h-3 w-3" />
            Claimed
            {bungalow.owner_farcaster ? ` by @${bungalow.owner_farcaster.username}` : ''}
          </span>
        )}
        {bungalow.verified && (
          <span className="inline-flex items-center gap-1 rounded-full border border-heat-resident/40 bg-heat-resident/15 px-2 py-1 text-heat-resident">
            <ShieldCheck className="h-3 w-3" />
            Verified
          </span>
        )}
      </div>
    </section>
  );
}
