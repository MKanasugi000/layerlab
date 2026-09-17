import { isJapaneseFont } from '../utils/jpFontAliases';

export const DEFAULT_TEXT_FONT = 'Noto Sans JP';

export interface BundledFont {
  family: string;
  category: 'japanese' | 'latin';
}

export const BUNDLED_FONTS: readonly BundledFont[] = [
  { family: DEFAULT_TEXT_FONT, category: 'japanese' },
  { family: 'Noto Serif JP', category: 'japanese' },
  { family: 'Zen Kaku Gothic New', category: 'japanese' },
  { family: 'Zen Old Mincho', category: 'japanese' },
  { family: 'M PLUS 1p', category: 'japanese' },
  { family: 'M PLUS Rounded 1c', category: 'japanese' },
  { family: 'BIZ UDPGothic', category: 'japanese' },
  { family: 'BIZ UDPMincho', category: 'japanese' },
  { family: 'Dela Gothic One', category: 'japanese' },
  { family: 'DotGothic16', category: 'japanese' },
  { family: 'Kaisei Decol', category: 'japanese' },
  { family: 'Kosugi Maru', category: 'japanese' },
  { family: 'Mochiy Pop One', category: 'japanese' },
  { family: 'RocknRoll One', category: 'japanese' },
  { family: 'Shippori Mincho', category: 'japanese' },
  { family: 'Yusei Magic', category: 'japanese' },
  { family: 'Open Sans', category: 'latin' },
  { family: 'Montserrat', category: 'latin' },
  { family: 'Poppins', category: 'latin' },
  { family: 'Lato', category: 'latin' },
  { family: 'Oswald', category: 'latin' },
  { family: 'Raleway', category: 'latin' },
  { family: 'Nunito', category: 'latin' },
  { family: 'Playfair Display', category: 'latin' },
  { family: 'Merriweather', category: 'latin' },
  { family: 'DM Sans', category: 'latin' },
  { family: 'Source Sans 3', category: 'latin' },
  { family: 'Bebas Neue', category: 'latin' },
  { family: 'Anton', category: 'latin' },
  { family: 'Pacifico', category: 'latin' },
];

export const BUNDLED_FONT_FAMILIES = BUNDLED_FONTS.map(({ family }) => family);
const BUNDLED_FONT_SET = new Set(BUNDLED_FONT_FAMILIES);

export function isBundledFont(family: string): boolean {
  return BUNDLED_FONT_SET.has(family);
}

/** Keep the curated, offline-ready catalogue first, followed by OS fonts. */
export function mergeAndSortFonts(systemFonts: string[]): string[] {
  const extra = [...new Set(systemFonts)]
    .filter((family) => !BUNDLED_FONT_SET.has(family))
    .sort((a, b) => {
      const japaneseOrder = Number(!isJapaneseFont(a)) - Number(!isJapaneseFont(b));
      return japaneseOrder || a.localeCompare(b, 'ja');
    });
  return [...BUNDLED_FONT_FAMILIES, ...extra];
}
