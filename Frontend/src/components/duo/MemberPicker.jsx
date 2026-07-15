import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Avatar } from '../ui.jsx';

/**
 * Combobox picker that scrolls the whole member directory and filters by
 * displayName OR githubUsername.
 *
 * ARIA structure follows the WAI combobox pattern: the trigger is
 * role="combobox" with aria-expanded/aria-controls, the panel's list is
 * role="listbox", each row is role="option", and highlight is tracked via
 * aria-activedescendant (not focus movement) so the search input keeps the
 * caret while the user arrows through options.
 *
 * Props:
 *   - members: full directory ({ githubUsername, displayName, avatarUrl }[]).
 *   - value: selected githubUsername ('' when nothing is chosen).
 *   - onChange(username): called with the picked username or '' when cleared.
 *   - disabledUsername: single username to render disabled (the value picked
 *     in the *other* slot on /compare — self-comparison isn't useful).
 *   - label: visible label above the trigger.
 *   - id: stable input id — used to link the label + a11y attrs.
 *   - reduced: when true, no open animation.
 */
export default function MemberPicker({
  members = [],
  value = '',
  onChange,
  disabledUsername = '',
  label,
  id,
  reduced = false,
  placeholder = 'Choose a member…',
}) {
  const generatedId = useId();
  const baseId = id || `member-picker-${generatedId}`;
  const listboxId = `${baseId}-listbox`;
  const searchId = `${baseId}-search`;
  const labelId = `${baseId}-label`;

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);

  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const searchRef = useRef(null);
  const listRef = useRef(null);

  const selected = useMemo(
    () => members.find((m) => m.githubUsername === value) ?? null,
    [members, value],
  );

  // Case-insensitive substring match on either field. No debounce — the list
  // is capped at 500 rows so this stays O(n) and instant.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return members;
    return members.filter((m) => {
      const dn = (m.displayName || '').toLowerCase();
      const gh = m.githubUsername.toLowerCase();
      return dn.includes(q) || gh.includes(q);
    });
  }, [members, query]);

  // Keep the highlighted row in-bounds as the filter changes.
  useEffect(() => {
    setHighlight((h) => {
      if (filtered.length === 0) return 0;
      return Math.min(h, filtered.length - 1);
    });
  }, [filtered.length]);

  // Click-outside closes.
  useEffect(() => {
    if (!open) return;
    const onDocPointer = (e) => {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDocPointer);
    return () => document.removeEventListener('pointerdown', onDocPointer);
  }, [open]);

  // Move focus to the search input every time we open, and reset scroll.
  useEffect(() => {
    if (!open) return;
    // Reset transient state on each open so the panel is predictable.
    setQuery('');
    setHighlight(pickInitialHighlight(members, value, disabledUsername));
    // Focus after paint so React has committed the input.
    requestAnimationFrame(() => {
      searchRef.current?.focus?.();
      if (listRef.current) listRef.current.scrollTop = 0;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Auto-scroll the highlighted option into view — the search input still has
  // focus, so we manage scroll manually rather than relying on browser focus.
  useEffect(() => {
    if (!open || !listRef.current) return;
    const el = listRef.current.querySelector(`[data-index="${highlight}"]`);
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ block: 'nearest' });
    }
  }, [highlight, open]);

  const pickAt = (i) => {
    const opt = filtered[i];
    if (!opt) return;
    if (opt.githubUsername === disabledUsername) return; // guard against Enter on disabled
    onChange?.(opt.githubUsername);
    setOpen(false);
    // Return focus to the trigger for keyboard users.
    requestAnimationFrame(() => triggerRef.current?.focus?.());
  };

  const advance = (delta) => {
    if (filtered.length === 0) return;
    setHighlight((h) => {
      // Skip past the disabled row so ArrowUp/Down doesn't strand the user.
      let next = h;
      for (let step = 0; step < filtered.length; step++) {
        next = (next + delta + filtered.length) % filtered.length;
        if (filtered[next].githubUsername !== disabledUsername) break;
      }
      return next;
    });
  };

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); if (!open) setOpen(true); else advance(1); return; }
    if (e.key === 'ArrowUp')   { e.preventDefault(); if (!open) setOpen(true); else advance(-1); return; }
    if (e.key === 'Home')      { if (open) { e.preventDefault(); setHighlight(0); } return; }
    if (e.key === 'End')       { if (open) { e.preventDefault(); setHighlight(filtered.length - 1); } return; }
    if (e.key === 'Enter')     { if (open) { e.preventDefault(); pickAt(highlight); } return; }
    if (e.key === 'Escape')    { if (open) { e.preventDefault(); setOpen(false); triggerRef.current?.focus?.(); } return; }
    if (e.key === 'Tab' && open) { setOpen(false); }
  };

  const onClear = (e) => {
    e.stopPropagation();
    onChange?.('');
    // Re-open so the user can pick again immediately.
    setOpen(true);
  };

  const activeOptionId = filtered[highlight]
    ? `${baseId}-opt-${filtered[highlight].githubUsername}`
    : undefined;

  return (
    <div className="stack gap-4" ref={rootRef}>
      <span id={labelId} className="text-xs uppercase tracking-wide text-ghmuted font-semibold">
        {label}
      </span>

      <div className="relative">
        <button
          ref={triggerRef}
          type="button"
          id={baseId}
          role="combobox"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-labelledby={labelId}
          onClick={() => setOpen((v) => !v)}
          onKeyDown={onKeyDown}
          className={
            'w-full flex items-center gap-2 rounded-xl border-2 border-ghborder bg-ghinset ' +
            'px-3 py-2 text-left text-ghfg ' +
            'hover:border-duo-green ' +
            'focus:outline-none focus-visible:ring-2 focus-visible:ring-duo-green ' +
            'focus-visible:ring-offset-2 focus-visible:ring-offset-ghsurface ' +
            'transition-colors'
          }
        >
          {selected ? (
            <>
              <Avatar
                src={selected.avatarUrl}
                alt={selected.displayName || selected.githubUsername}
                size={24}
              />
              <span className="min-w-0 flex-1 truncate">
                <span className="font-semibold">
                  {selected.displayName || selected.githubUsername}
                </span>
                <span className="text-ghmuted font-mono text-xs ml-1.5">
                  @{selected.githubUsername}
                </span>
              </span>
              <span
                role="button"
                tabIndex={-1}
                aria-label={`Clear ${selected.displayName || selected.githubUsername}`}
                onClick={onClear}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    e.stopPropagation();
                    onChange?.('');
                    setOpen(true);
                  }
                }}
                className="ml-1 text-ghmuted hover:text-ghfg cursor-pointer rounded-full w-6 h-6 flex items-center justify-center hover:bg-ghborder/40"
              >
                ×
              </span>
            </>
          ) : (
            <span className="text-ghmuted flex-1">{placeholder}</span>
          )}
          <span aria-hidden="true" className="text-ghmuted text-xs ml-auto">
            {open ? '▲' : '▼'}
          </span>
        </button>

        {open && (
          <div
            className={
              'member-picker-panel absolute left-0 right-0 top-[calc(100%+4px)] z-20 ' +
              'rounded-xl border-2 border-ghborder bg-ghsurface shadow-lg overflow-hidden'
            }
            data-reduced={reduced ? 'true' : 'false'}
          >
            <div className="p-2 border-b border-ghborder bg-ghinset">
              <input
                ref={searchRef}
                type="text"
                id={searchId}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="Search…"
                aria-controls={listboxId}
                aria-activedescendant={activeOptionId}
                autoComplete="off"
                spellCheck={false}
                className={
                  'w-full rounded-lg border border-ghborder bg-ghsurface px-2 py-1.5 ' +
                  'text-ghfg focus:outline-none focus:border-duo-green'
                }
              />
            </div>

            <ul
              ref={listRef}
              id={listboxId}
              role="listbox"
              aria-labelledby={labelId}
              className="max-h-[280px] overflow-y-auto"
            >
              {filtered.length === 0 ? (
                <li className="px-3 py-6 text-center text-ghmuted text-sm italic">
                  No members match
                </li>
              ) : (
                filtered.map((m, i) => {
                  const disabled = m.githubUsername === disabledUsername;
                  const isHighlighted = i === highlight;
                  const isSelected = m.githubUsername === value;
                  const optId = `${baseId}-opt-${m.githubUsername}`;
                  return (
                    <li
                      key={m.githubUsername}
                      id={optId}
                      role="option"
                      aria-selected={isSelected}
                      aria-disabled={disabled}
                      data-index={i}
                      onMouseEnter={() => !disabled && setHighlight(i)}
                      onClick={() => !disabled && pickAt(i)}
                      className={
                        'flex items-center gap-3 px-3 py-2 cursor-pointer ' +
                        (disabled
                          ? 'opacity-40 cursor-not-allowed '
                          : '') +
                        (isHighlighted && !disabled
                          ? 'bg-duo-green/15 text-ghfg '
                          : 'text-ghfg ')
                      }
                    >
                      <Avatar
                        src={m.avatarUrl}
                        alt={m.displayName || m.githubUsername}
                        size={32}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block font-semibold truncate">
                          {m.displayName || m.githubUsername}
                        </span>
                        <span className="block text-xs text-ghmuted font-mono truncate">
                          @{m.githubUsername}
                          {disabled && ' · already picked'}
                        </span>
                      </span>
                    </li>
                  );
                })
              )}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

/** Prefer the currently-selected row, else the first non-disabled row. */
function pickInitialHighlight(members, value, disabled) {
  if (value) {
    const i = members.findIndex((m) => m.githubUsername === value);
    if (i >= 0) return i;
  }
  for (let i = 0; i < members.length; i++) {
    if (members[i].githubUsername !== disabled) return i;
  }
  return 0;
}
