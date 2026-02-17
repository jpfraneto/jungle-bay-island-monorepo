import { useCallback, useEffect, useRef, useState } from 'react';
import { Pencil } from 'lucide-react';

interface EditableTextProps {
  value: string;
  placeholder?: string;
  canEdit: boolean;
  onSave: (value: string) => void | Promise<void>;
  multiline?: boolean;
  maxLength?: number;
  className?: string;
}

export function EditableText({
  value,
  placeholder = 'Click to add...',
  canEdit,
  onSave,
  multiline = false,
  maxLength,
  className = '',
}: EditableTextProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement | HTMLInputElement>(null);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.setSelectionRange(draft.length, draft.length);
    }
  }, [editing]);

  const handleSave = useCallback(async () => {
    const trimmed = draft.trim();
    if (trimmed === value) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      await onSave(trimmed);
    } finally {
      setSaving(false);
      setEditing(false);
    }
  }, [draft, value, onSave]);

  const handleCancel = useCallback(() => {
    setDraft(value);
    setEditing(false);
  }, [value]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleCancel();
      }
      if (e.key === 'Enter' && (!multiline || e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        void handleSave();
      }
    },
    [handleCancel, handleSave, multiline],
  );

  if (editing) {
    const charCount = maxLength ? `${draft.length}/${maxLength}` : undefined;

    return (
      <div className="relative">
        {multiline ? (
          <textarea
            ref={inputRef as React.RefObject<HTMLTextAreaElement>}
            value={draft}
            onChange={(e) => setDraft(maxLength ? e.target.value.slice(0, maxLength) : e.target.value)}
            onBlur={() => void handleSave()}
            onKeyDown={handleKeyDown}
            rows={4}
            className={`w-full resize-y rounded-lg border border-heat-observer/40 bg-jungle-900 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-heat-observer ${className}`}
            disabled={saving}
          />
        ) : (
          <input
            ref={inputRef as React.RefObject<HTMLInputElement>}
            type="text"
            value={draft}
            onChange={(e) => setDraft(maxLength ? e.target.value.slice(0, maxLength) : e.target.value)}
            onBlur={() => void handleSave()}
            onKeyDown={handleKeyDown}
            className={`w-full rounded-lg border border-heat-observer/40 bg-jungle-900 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-heat-observer ${className}`}
            disabled={saving}
          />
        )}
        <div className="mt-1 flex items-center justify-between text-[11px] text-zinc-500">
          <span>{saving ? 'Saving...' : multiline ? 'Ctrl+Enter to save, Esc to cancel' : 'Enter to save, Esc to cancel'}</span>
          {charCount && <span>{charCount}</span>}
        </div>
      </div>
    );
  }

  const displayValue = value || placeholder;
  const isEmpty = !value;

  if (!canEdit) {
    return <span className={`${isEmpty ? 'text-zinc-500' : ''} ${className}`}>{displayValue}</span>;
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className={`group relative inline-flex w-full cursor-pointer items-start gap-2 rounded-lg border border-dashed border-transparent px-2 py-1 text-left transition-colors hover:border-zinc-600 hover:bg-jungle-900/50 ${isEmpty ? 'text-zinc-500' : ''} ${className}`}
    >
      <span className="flex-1">{displayValue}</span>
      <Pencil className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-zinc-500 opacity-0 transition-opacity group-hover:opacity-100" />
    </button>
  );
}
