import type { Bungalow } from '../../lib/types';
import { HOME_TEAM_TICKERS } from '../../config';
import { EditableText } from '../common/EditableText';

const seededCulture: Record<string, string> = {
  JBM: 'Jungle Bay Memetics began as campfire signal for builders on Base, mixing identity and utility.',
  BNKR: 'BNKR grew through persistence: a bunker of long-term operators holding through every weather cycle.',
};

interface WallProps {
  bungalow: Bungalow;
  canEdit?: boolean;
  onSaveOriginStory?: (value: string) => void | Promise<void>;
}

export function Wall({ bungalow, canEdit = false, onSaveOriginStory }: WallProps) {
  const seeded = HOME_TEAM_TICKERS.includes(bungalow.token_symbol)
    ? seededCulture[bungalow.token_symbol] || 'Home Team token with deep island lore and active cultural stewards.'
    : undefined;

  const content = bungalow.origin_story || seeded;

  return (
    <section className="card space-y-3">
      <div className="text-xs uppercase tracking-[0.18em] text-zinc-400">02 - The Wall</div>
      {canEdit && onSaveOriginStory ? (
        <div className="whitespace-pre-wrap text-sm leading-7 text-zinc-200">
          <EditableText
            value={bungalow.origin_story || ''}
            placeholder="Tell your token's origin story..."
            canEdit={canEdit}
            onSave={onSaveOriginStory}
            multiline
            maxLength={2000}
          />
        </div>
      ) : content ? (
        <p className="whitespace-pre-wrap text-sm leading-7 text-zinc-200">{content}</p>
      ) : (
        <p className="text-sm text-zinc-400">
          This bungalow is waiting for its origin story. Claim this token and add the culture, history, and visual identity.
        </p>
      )}
    </section>
  );
}
