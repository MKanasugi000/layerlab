import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import {
  fontMatches,
  getJapaneseAliases,
  isJapaneseFont,
} from '../utils/jpFontAliases';
import {
  BUNDLED_FONT_FAMILIES,
  isBundledFont,
  mergeAndSortFonts,
} from '../fonts/catalog';
import { useT } from '../i18n/locale';

export function FontPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (font: string) => void;
}) {
  const t = useT();
  const [fonts, setFonts] = useState<string[]>(BUNDLED_FONT_FAMILIES);
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const [jpOnly, setJpOnly] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listId = useId();

  useEffect(() => {
    const listFonts = window.layerlab?.listFonts;
    if (!listFonts) return;
    listFonts().then(setFonts).catch(() => setFonts([]));
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
        setFilter('');
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const ordered = useMemo(() => mergeAndSortFonts(fonts), [fonts]);

  const filtered = useMemo(() => {
    let list = ordered;
    if (jpOnly) list = list.filter((f) => isJapaneseFont(f));
    if (filter) list = list.filter((f) => fontMatches(f, filter));
    return list;
  }, [ordered, filter, jpOnly]);

  const jpCount = useMemo(() => ordered.filter(isJapaneseFont).length, [ordered]);
  const valueAliases = getJapaneseAliases(value);
  const valueAlias = valueAliases[0];
  const visibleFonts = filtered.slice(0, 300);
  const activeFont = visibleFonts[Math.min(activeIndex, Math.max(0, visibleFonts.length - 1))];

  useEffect(() => {
    if (!open) return;
    const selected = visibleFonts.indexOf(value);
    setActiveIndex(selected >= 0 ? selected : 0);
  }, [open, filter, jpOnly, value]);

  const close = () => {
    setOpen(false);
    setFilter('');
  };

  const choose = (font: string) => {
    onChange(font);
    close();
    requestAnimationFrame(() => triggerRef.current?.focus());
  };

  const onPickerKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!open) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        setOpen(true);
      }
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      requestAnimationFrame(() => triggerRef.current?.focus());
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      if (visibleFonts.length === 0) return;
      setActiveIndex((current) => {
        if (event.key === 'Home') return 0;
        if (event.key === 'End') return visibleFonts.length - 1;
        const delta = event.key === 'ArrowDown' ? 1 : -1;
        return (current + delta + visibleFonts.length) % visibleFonts.length;
      });
      return;
    }
    if (event.key === 'Enter' && activeFont && event.target instanceof HTMLInputElement) {
      event.preventDefault();
      choose(activeFont);
    }
  };

  return (
    <div className="font-picker" ref={rootRef} onKeyDown={onPickerKeyDown}>
      <button
        ref={triggerRef}
        type="button"
        className="font-picker-trigger"
        onClick={() => setOpen(!open)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
      >
        <span style={{ fontFamily: `"${value}", sans-serif` }} className="trigger-name">
          {value}
        </span>
        {valueAlias && <span className="trigger-alias">{valueAlias}</span>}
        <span className="trigger-arrow">▾</span>
      </button>
      {open && (
        <div className="font-picker-dropdown">
          <div className="picker-toolbar">
            <input
              type="text"
              placeholder={t({ ja: 'フォント検索（メイリオ / Meiryo どちらでも）...', en: 'Search fonts (e.g., メイリオ / Meiryo)...' })}
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              autoFocus
              role="combobox"
              aria-autocomplete="list"
              aria-expanded="true"
              aria-controls={listId}
              aria-activedescendant={activeFont ? `${listId}-${activeIndex}` : undefined}
            />
            <button
              type="button"
              className={`jp-toggle ${jpOnly ? 'active' : ''}`}
              onClick={() => setJpOnly(!jpOnly)}
              title={t({ ja: `日本語フォントのみ表示 (${jpCount}本)`, en: `Show only Japanese fonts (${jpCount})` })}
            >
              {t({ ja: '日本語のみ', en: 'Japanese only' })} {jpOnly && '✓'}
            </button>
          </div>
          <ul id={listId} role="listbox" aria-label={t({ ja: 'フォント', en: 'Fonts' })}>
            {visibleFonts.map((f, index) => {
              const aliases = getJapaneseAliases(f);
              const isJa = isJapaneseFont(f);
              const bundled = isBundledFont(f);
              return (
                <li
                  id={`${listId}-${index}`}
                  key={f}
                  role="option"
                  aria-selected={f === value}
                  className={`${f === value ? 'selected' : ''} ${index === activeIndex ? 'active' : ''} ${isJa ? 'jp' : ''}`}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => choose(f)}
                >
                  {isJa && <span className="jp-badge">JP</span>}
                  {bundled && (
                    <span className="bundled-font-badge">
                      {t({ ja: '内蔵', en: 'Built-in' })}
                    </span>
                  )}
                  <span
                    className="font-name"
                    style={{ fontFamily: `"${f}", sans-serif` }}
                  >
                    {f}
                  </span>
                  {aliases.length > 0 && (
                    <span className="font-alias">{aliases[0]}</span>
                  )}
                </li>
              );
            })}
            {filtered.length > 300 && (
              <li className="more">{t({ ja: `... +${filtered.length - 300} 件（絞り込んで）`, en: `... +${filtered.length - 300} more (refine search)` })}</li>
            )}
            {filtered.length === 0 && <li className="more">{t({ ja: '該当なし', en: 'No matches' })}</li>}
          </ul>
          <div className="picker-footer">
            {t({ ja: `計 ${ordered.length}本 / 日本語 ${jpCount}本`, en: `Total ${ordered.length} / Japanese ${jpCount}` })}
          </div>
        </div>
      )}
    </div>
  );
}
