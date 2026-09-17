import { readPsd, type Layer as PsdLayer, type Psd } from 'ag-psd';
import { newId } from '../store/editorStore';
import type {
  Layer,
  ImageLayer,
  GroupLayer,
  BlendMode,
  CanvasConfig,
  LayerId,
} from '../types';
import { t } from '../i18n/locale';
import {
  MAX_PSD_LAYERS,
  MAX_PSD_LAYER_PIXELS,
  validatePsdHeader,
  validatePsdLayerBudget,
  type PsdLayerBudgetResult,
  type PsdValidationResult,
} from './psdLimits';

/**
 * Photoshop のブレンドモード名 → LayerLab(Konva globalCompositeOperation) への写像。
 * Konva に対応する合成モードが無い PSD 固有モード（linear burn 等）は、
 * 見た目が最も近い標準モードへ寄せる。未知のモードは通常合成にフォールバック。
 */
const BLEND_MAP: Record<string, BlendMode> = {
  'pass through': 'source-over', // グループのパススルー（LayerLab は通常合成扱い）
  normal: 'source-over',
  dissolve: 'source-over',
  darken: 'darken',
  multiply: 'multiply',
  'color burn': 'color-burn',
  'linear burn': 'multiply',
  'darker color': 'darken',
  lighten: 'lighten',
  screen: 'screen',
  'color dodge': 'color-dodge',
  'linear dodge': 'lighten',
  'lighter color': 'lighten',
  overlay: 'overlay',
  'soft light': 'soft-light',
  'hard light': 'hard-light',
  'vivid light': 'hard-light',
  'linear light': 'hard-light',
  'pin light': 'hard-light',
  'hard mix': 'hard-light',
  difference: 'difference',
  exclusion: 'exclusion',
  subtract: 'difference',
  divide: 'source-over',
  hue: 'hue',
  saturation: 'saturation',
  color: 'color',
  luminosity: 'luminosity',
};

function mapBlend(mode?: string): BlendMode {
  return (mode && BLEND_MAP[mode]) || 'source-over';
}

export interface PsdProject {
  canvas: CanvasConfig;
  layers: Layer[];
  selectedId: LayerId | null;
}

/** BaseLayer 共通プロパティを PSD レイヤーから生成。 */
function baseProps(l: PsdLayer) {
  return {
    id: newId(),
    visible: l.hidden !== true,
    locked: false,
    opacity: typeof l.opacity === 'number' ? l.opacity : 1,
    blendMode: mapBlend(l.blendMode),
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
  };
}

/**
 * ag-psd の Layer ツリー（children は下→上）を LayerLab のフラット配列
 * （先頭=最前面、parentId でグループ階層を表現）へ変換する。
 * PSD パネルの上＝LayerLab の前面に来るよう、各階層を上から順に push する。
 */
function flatten(nodes: PsdLayer[], parentId: string | null, out: Layer[]): void {
  for (let i = nodes.length - 1; i >= 0; i--) {
    const n = nodes[i];

    // グループ（セクション）: children を持つ
    if (n.children && n.children.length > 0) {
      const group: GroupLayer = {
        ...baseProps(n),
        type: 'group',
        name: n.name || t({ ja: 'グループ', en: 'Group' }),
        x: 0,
        y: 0,
        parentId,
        collapsed: n.opened === false,
      };
      out.push(group);
      flatten(n.children, group.id, out);
      continue;
    }

    // ピクセルを持つレイヤー（ラスター/テキスト/シェイプはラスタライズ済 canvas として取得）
    const cv = n.canvas;
    if (!cv || cv.width < 1 || cv.height < 1) continue; // 空・調整レイヤー等はスキップ
    const layer: ImageLayer = {
      ...baseProps(n),
      type: 'image',
      name: n.name || t({ ja: 'レイヤー', en: 'Layer' }),
      x: n.left ?? 0,
      y: n.top ?? 0,
      parentId,
      clipped: n.clipping === true,
      src: cv.toDataURL('image/png'),
      naturalWidth: cv.width,
      naturalHeight: cv.height,
    };
    out.push(layer);
  }
}

/** PSD カラーモード番号 → 日本語名（ヘッダ offset 24 の u16）。 */
const COLOR_MODE_NAMES: Record<number, { ja: string; en: string }> = {
  0: { ja: 'モノクロ2階調 (Bitmap)', en: 'Bitmap (Monochrome)' },
  1: { ja: 'グレースケール', en: 'Grayscale' },
  2: { ja: 'インデックスカラー', en: 'Indexed Color' },
  3: { ja: 'RGB カラー', en: 'RGB Color' },
  4: { ja: 'CMYK カラー', en: 'CMYK Color' },
  7: { ja: 'マルチチャンネル', en: 'Multichannel' },
  8: { ja: 'ダブルトーン (Duotone)', en: 'Duotone' },
  9: { ja: 'Lab カラー', en: 'Lab Color' },
};
// ag-psd（→LayerLab）が確実にラスタライズして表示できるモードのみ許可する。
// CMYK / Lab / マルチチャンネル / ダブルトーン / モノクロ2階調 は ag-psd が
// 「Color mode not supported」で弾く＝事前に分かりやすい日本語で案内する。
const SUPPORTED_COLOR_MODES = new Set([1, 2, 3]); // Grayscale / Indexed / RGB

function preflightError(result: Exclude<PsdValidationResult, { ok: true }>, fileName: string): Error {
  if (result.code === 'file-too-large') {
    return new Error(t({ ja: `PSD/PSB は 128 MB 以下にしてください: ${fileName}`, en: `PSD/PSB must be 128 MB or smaller: ${fileName}` }));
  }
  if (result.code === 'unsafe-canvas') {
    return new Error(t({
      ja: `PSD/PSB のキャンバス ${result.width}×${result.height}px は安全上限（8192px / 32MP）を超えています: ${fileName}`,
      en: `PSD/PSB canvas ${result.width}×${result.height}px exceeds the safe limit (8192 px / 32 MP): ${fileName}`,
    }));
  }
  return new Error(t({
    ja: `PSD/PSB ヘッダーが壊れているか、対応していない形式です: ${fileName}`,
    en: `The PSD/PSB header is corrupt or unsupported: ${fileName}`,
  }));
}

function layerBudgetError(
  result: Exclude<PsdLayerBudgetResult, { ok: true }>,
  fileName: string,
): Error {
  if (result.code === 'too-many-layers') {
    return new Error(t({
      ja: `PSD/PSB のレイヤー数が安全上限（${MAX_PSD_LAYERS}）を超えています: ${fileName}`,
      en: `PSD/PSB exceeds the safe layer-count limit (${MAX_PSD_LAYERS}): ${fileName}`,
    }));
  }
  if (result.code === 'too-many-layer-pixels') {
    return new Error(t({
      ja: `PSD/PSB の全レイヤー画像面積が安全上限（${Math.round(MAX_PSD_LAYER_PIXELS / 1024 / 1024)}MP）を超えています。Photoshopで不要レイヤーを統合してから再試行してください: ${fileName}`,
      en: `PSD/PSB layer image area exceeds the safe limit (${Math.round(MAX_PSD_LAYER_PIXELS / 1024 / 1024)} MP). Merge unnecessary layers in Photoshop and try again: ${fileName}`,
    }));
  }
  return new Error(t({
    ja: `PSD/PSB に安全に展開できないレイヤー範囲があります（${result.width ?? '?'}×${result.height ?? '?'}px）: ${fileName}`,
    en: `PSD/PSB contains layer bounds that cannot be safely expanded (${result.width ?? '?'} x ${result.height ?? '?'} px): ${fileName}`,
  }));
}

/** PSD/PSB の ArrayBuffer を LayerLab プロジェクト構造へ変換。 */
export function psdArrayBufferToProject(
  buffer: ArrayBuffer,
  fileName: string,
): PsdProject {
  const preflight = validatePsdHeader(buffer, buffer.byteLength);
  if (!preflight.ok) throw preflightError(preflight, fileName);
  // 早期診断: 空 / 署名不正を文脈付きで弾く。
  // ag-psd の生 "Invalid signature" は原因(壊れ・切れ・非PSD)が分からないため、
  // 先頭バイトとサイズを添えて何が起きたか分かるメッセージにする。
  const size = buffer.byteLength;
  if (size < 4) {
    throw new Error(
      t({
        ja: `ファイルが空か小さすぎます (${size} bytes): ${fileName}`,
        en: `File is empty or too small (${size} bytes): ${fileName}`,
      }),
    );
  }
  const head = new Uint8Array(buffer, 0, 4);
  const sig = String.fromCharCode(head[0], head[1], head[2], head[3]);
  if (sig !== '8BPS') {
    const hex = Array.from(head)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join(' ');
    throw new Error(
      t({
        ja:
          `PSD署名(8BPS)がありません。先頭="${sig}" (${hex}) / サイズ=${size}B。` +
          `ファイルが壊れている・書き出し/ダウンロードが未完了・PSD形式でない可能性があります: ${fileName}`,
        en:
          `PSD signature (8BPS) not found. Header="${sig}" (${hex}) / Size=${size}B. ` +
          `The file may be corrupt, incomplete export/download, or not in PSD format: ${fileName}`,
      }),
    );
  }
  // カラーモード事前検査: ag-psd が表示できないモード（CMYK/Lab/Duotone 等）は
  // 解析前に弾き、原因と直し方（RGB へ変換）を日本語で具体的に伝える。
  // ヘッダは [4 sig][2 ver][6 予約][2 ch][4 h][4 w][2 depth][2 colorMode] = 26B。
  if (size >= 26) {
    const colorMode = new DataView(buffer).getUint16(24, false);
    if (!SUPPORTED_COLOR_MODES.has(colorMode)) {
      const name = t(COLOR_MODE_NAMES[colorMode] ?? { ja: `モード番号 ${colorMode}`, en: `Mode ${colorMode}` });
      throw new Error(
        t({
          ja:
            `このPSDは「${name}」で保存されているため読み込めません。` +
            `LayerLab は RGB / グレースケール / インデックスカラー のみ対応しています。` +
            `Photoshop 等で [イメージ → モード → RGBカラー] に変換して保存し直してから、もう一度読み込んでください（${fileName}）。`,
          en:
            `This PSD is saved in "${name}" mode and cannot be loaded. ` +
            `LayerLab only supports RGB / Grayscale / Indexed Color. ` +
            `Please convert it to RGB color in Photoshop etc. (Image → Mode → RGB Color), save again, and try reopening (${fileName}).`,
        }),
      );
    }
  }
  // First parse structure only. ag-psd's normal pass allocates a canvas for
  // every raster layer, so document dimensions alone cannot prevent a small,
  // highly layered PSD from exhausting renderer memory.
  let metadata: Psd;
  try {
    metadata = readPsd(buffer, {
      skipLayerImageData: true,
      skipCompositeImageData: true,
      skipThumbnail: true,
      skipLinkedFilesData: true,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(t({
      ja: `PSD構造の事前解析に失敗しました (サイズ=${size}B, ${fileName}): ${msg}`,
      en: `PSD structure preflight failed (size=${size}B, ${fileName}): ${msg}`,
    }));
  }
  const layerBudget = validatePsdLayerBudget(metadata.children ?? []);
  if (!layerBudget.ok) throw layerBudgetError(layerBudget, fileName);

  let psd: Psd;
  try {
    psd = readPsd(buffer, {
      skipThumbnail: true,
      skipLinkedFilesData: true,
      // A layered document is flattened from its individual canvases below;
      // decoding the unused composite would add up to another 128 MB peak.
      // Keep it only for truly flat/empty-layer PSD fallback.
      skipCompositeImageData: layerBudget.layerPixels > 0,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // "Invalid signature ... at offset N" 等をサイズ付きで出し、
    // 途中で切れている(offset≪size)のか等を判別できるようにする。
    throw new Error(
      t({
        ja: `PSD解析に失敗しました (サイズ=${size}B, ${fileName}): ${msg}`,
        en: `PSD parsing failed (size=${size}B, ${fileName}): ${msg}`,
      }),
    );
  }
  return psdToProject(psd, fileName);
}

/** 解析済み ag-psd ドキュメントを LayerLab プロジェクト構造へ変換（テスト容易化のため分離）。 */
export function psdToProject(psd: Psd, fileName: string): PsdProject {
  const layers: Layer[] = [];
  flatten(psd.children ?? [], null, layers);

  // レイヤー情報の無いフラット PSD は、合成画像を 1 枚絵として取り込む
  if (layers.length === 0) {
    const cv = psd.canvas;
    if (!cv || cv.width < 1 || cv.height < 1) {
      throw new Error(t({ ja: 'PSD にレイヤー画像が見つかりませんでした', en: 'No layer images found in PSD' }));
    }
    layers.push({
      id: newId(),
      type: 'image',
      name: fileName || t({ ja: '画像', en: 'Image' }),
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: 'source-over',
      x: 0,
      y: 0,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      parentId: null,
      src: cv.toDataURL('image/png'),
      naturalWidth: cv.width,
      naturalHeight: cv.height,
    } as ImageLayer);
  }

  const firstImage = layers.find((l) => l.type !== 'group') ?? layers[0];
  return {
    canvas: { width: psd.width, height: psd.height, background: 'transparent' },
    layers,
    selectedId: firstImage ? firstImage.id : null,
  };
}
