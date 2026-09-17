export const JP_FONT_ALIASES: Record<string, string[]> = {
  'Yu Gothic': ['游ゴシック', '游ゴシック体'],
  'Yu Gothic UI': ['游ゴシック UI'],
  'Yu Gothic Medium': ['游ゴシック Medium'],
  'Yu Gothic Light': ['游ゴシック Light'],
  'Yu Mincho': ['游明朝', '游明朝体'],
  'Yu Mincho Light': ['游明朝 Light'],
  'Yu Mincho Demibold': ['游明朝 Demibold'],
  'Meiryo': ['メイリオ'],
  'Meiryo UI': ['メイリオ UI'],
  'MS Gothic': ['ＭＳ ゴシック', 'MSゴシック'],
  'MS Mincho': ['ＭＳ 明朝', 'MS明朝'],
  'MS PGothic': ['ＭＳ Ｐゴシック', 'MS Pゴシック'],
  'MS PMincho': ['ＭＳ Ｐ明朝', 'MS P明朝'],
  'MS UI Gothic': ['ＭＳ UI Gothic'],
  'BIZ UDGothic': ['BIZ UDゴシック'],
  'BIZ UDMincho': ['BIZ UD明朝'],
  'BIZ UDPGothic': ['BIZ UDPゴシック'],
  'BIZ UDPMincho': ['BIZ UDP明朝'],
  'UD Digi Kyokasho N': ['UDデジタル教科書体 N'],
  'UD Digi Kyokasho NP': ['UDデジタル教科書体 NP'],
  'UD Digi Kyokasho NK': ['UDデジタル教科書体 NK'],
  'Noto Sans JP': ['新ゴ系（標準）', 'Noto Sans 日本語', '源ノ角ゴシック JP'],
  'Noto Serif JP': ['Noto Serif 日本語', '源ノ明朝 JP'],
  'Zen Kaku Gothic New': ['新ゴ系・角ゴシック', 'ZEN角ゴシック New'],
  'Zen Old Mincho': ['ZENオールド明朝'],
  'M PLUS 1p': ['M+ 1p', 'エムプラス 1p'],
  'M PLUS Rounded 1c': ['M+ Rounded 1c', '丸ゴシック'],
  'Dela Gothic One': ['デラゴシック One'],
  DotGothic16: ['ドットゴシック16'],
  'Kaisei Decol': ['解星デコール'],
  'Kosugi Maru': ['小杉丸ゴシック'],
  'Mochiy Pop One': ['モッチーポップ One'],
  'RocknRoll One': ['ロックンロール One'],
  'Shippori Mincho': ['しっぽり明朝'],
  'Yusei Magic': ['油性マジック'],
  'Hiragino Kaku Gothic Pro': ['ヒラギノ角ゴ Pro'],
  'Hiragino Kaku Gothic ProN': ['ヒラギノ角ゴ ProN'],
  'Hiragino Mincho Pro': ['ヒラギノ明朝 Pro'],
  'Hiragino Mincho ProN': ['ヒラギノ明朝 ProN'],
  'Hiragino Sans': ['ヒラギノ角ゴシック'],
  Kanji_yutsudu: ['漢字ゆつづ'],
  'Kaisotai Next UP': ['楷書体 Next UP'],
  SanafonMaruJ: ['さなフォン丸J'],
  onryou: ['怨霊'],
  'Lord Eratgon': ['ロード・エラトゴン'],
};

const ALL_JP_KEYS = new Set(Object.keys(JP_FONT_ALIASES));
const HAS_JP_CHAR = /[぀-ヿ一-鿿ｦ-ﾟ]/;

export function isJapaneseFont(name: string): boolean {
  if (ALL_JP_KEYS.has(name)) return true;
  if (HAS_JP_CHAR.test(name)) return true;
  return false;
}

export function getJapaneseAliases(name: string): string[] {
  return JP_FONT_ALIASES[name] ?? [];
}

export function fontMatches(name: string, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase().trim();
  if (name.toLowerCase().includes(q)) return true;
  const aliases = JP_FONT_ALIASES[name];
  if (aliases) {
    return aliases.some((a) => a.toLowerCase().includes(q));
  }
  return false;
}

export function sortJapaneseFirst(fonts: string[]): string[] {
  return [...fonts].sort((a, b) => {
    const aJa = isJapaneseFont(a) ? 0 : 1;
    const bJa = isJapaneseFont(b) ? 0 : 1;
    if (aJa !== bJa) return aJa - bJa;
    return a.localeCompare(b, 'ja');
  });
}
