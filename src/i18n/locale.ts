import { create } from 'zustand';

// LayerLab 二言語（日本語 / 英語）i18n。外部依存を積まない自前実装。
// - React コンポーネント: `const t = useT();` → `t({ ja: '...', en: '...' })`（locale 変更で自動再描画）
// - 非React（utils / store / イベントハンドラ / toast）: `import { t }` → 呼び出し時点の locale を読む
// ⚠モジュールトップレベルで `t()` を評価しない（locale が固定化される）。必ず関数/描画/ハンドラ内で呼ぶ。

export type Locale = 'ja' | 'en';

/** 日本語・英語の対訳ペア。UI 文字列は全てこの形で表す。 */
export interface Bi {
  ja: string;
  en: string;
}

const STORAGE_KEY = 'llab-locale';

function syncDocumentLanguage(locale: Locale): void {
  if (typeof document !== 'undefined') document.documentElement.lang = locale;
}

/** 保存済み設定 → OS 言語 → 英語 の優先で初期 locale を決める（日本国外＝英語デフォルト）。 */
function detectLocale(): Locale {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'ja' || saved === 'en') return saved;
  } catch {
    /* localStorage 不可環境は無視 */
  }
  try {
    const nav = (
      navigator.language ||
      (navigator.languages && navigator.languages[0]) ||
      ''
    ).toLowerCase();
    return nav.startsWith('ja') ? 'ja' : 'en';
  } catch {
    /* navigator 不在は無視 */
  }
  return 'en';
}

interface LocaleState {
  locale: Locale;
  setLocale: (l: Locale) => void;
  toggleLocale: () => void;
}

const initialLocale = detectLocale();
syncDocumentLanguage(initialLocale);

export const useLocale = create<LocaleState>((set, get) => ({
  locale: initialLocale,
  setLocale: (locale) => {
    try {
      localStorage.setItem(STORAGE_KEY, locale);
    } catch {
      /* 保存不可でもメモリ上は反映 */
    }
    syncDocumentLanguage(locale);
    set({ locale });
  },
  toggleLocale: () => get().setLocale(get().locale === 'ja' ? 'en' : 'ja'),
}));

/** 非React 用：現在の locale を同期取得。 */
export function getLocale(): Locale {
  return useLocale.getState().locale;
}

/**
 * 非React 用の文字列リゾルバ（toast / utils / イベントハンドラ）。
 * 呼び出し時点の locale で解決するので、都度呼べば常に最新言語になる。
 */
export function t(s: Bi): string {
  return s[getLocale()];
}

/**
 * React コンポーネント用フック。現在の locale を購読して返すリゾルバ。
 * locale 変更時にこのフックを使うコンポーネントは自動で再描画される。
 */
export function useT(): (s: Bi) => string {
  const locale = useLocale((st) => st.locale);
  return (s: Bi) => s[locale];
}
