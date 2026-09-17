export interface WorkspacePointerContext {
  button: number;
  target: EventTarget | null;
  currentTarget: EventTarget | null;
  tool?: string;
  shiftKey?: boolean;
  insideCanvas?: boolean;
}

export interface MarqueeCanvasEnterContext {
  tool: string;
  hasDraft: boolean;
  buttons: number;
  shiftKey: boolean;
}

export interface CanvasPoint {
  x: number;
  y: number;
}

/**
 * 移動ツールで画像外のワークスペースを左クリックしたときだけ
 * レイヤー選択を解除する。画像内・他ツール・右クリックでは維持する。
 */
export function shouldClearLayerSelection({
  button,
  target,
  currentTarget,
  tool,
  insideCanvas,
}: WorkspacePointerContext): boolean {
  const isInsideCanvas = insideCanvas ?? target !== currentTarget;
  return button === 0 && tool === 'move' && !isInsideCanvas;
}

/**
 * 画像外のワークスペースを通常の左クリックしたとき、ピクセル選択を解除する。
 * Shift + 画像外ドラッグは既存選択へ追加するマーキー操作なので維持する。
 */
export function shouldClearPixelSelection({
  button,
  target,
  currentTarget,
  tool,
  shiftKey,
  insideCanvas,
}: WorkspacePointerContext): boolean {
  const isInsideCanvas = insideCanvas ?? target !== currentTarget;
  return (
    button === 0 &&
    !isInsideCanvas &&
    !(tool === 'marquee' && shiftKey)
  );
}

/**
 * 画像外で始めた左ドラッグが、Shift を押したまま画像へ入ったときだけ
 * マーキー選択を開始する。buttons は MouseEvent.buttons のビットマスク。
 */
export function shouldStartMarqueeOnCanvasEnter({
  tool,
  hasDraft,
  buttons,
  shiftKey,
}: MarqueeCanvasEnterContext): boolean {
  return tool === 'marquee' && !hasDraft && (buttons & 1) === 1 && shiftKey;
}

/** 画像外の始点が選択座標へ漏れないよう、開始点を画像境界内へ収める。 */
export function clampPointToCanvas(
  point: CanvasPoint,
  width: number,
  height: number,
): CanvasPoint {
  return {
    x: Math.max(0, Math.min(width, point.x)),
    y: Math.max(0, Math.min(height, point.y)),
  };
}
