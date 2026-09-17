/**
 * ラスターブラシ描画エンジン（2D Canvas・GPU非依存）。
 * スタンプ（radial gradient の円）を等間隔で補間して連続ストロークにする。
 * 硬さ=縁のグラデ、流量=スタンプ毎α、不透明度=ストローク合成時のαで表現する
 * （Photoshop のブラシ挙動に準拠）。
 */

export interface BrushParams {
  /** 直径(px・キャンバス座標) */
  size: number;
  /** 0..100（100=ほぼ硬い縁、0=完全なソフト） */
  hardness: number;
  /** 0..100（ストローク全体の合成α。Canvas 側で適用） */
  opacity: number;
  /** 0..100（1スタンプのα＝重ね塗りの溜まり） */
  flow: number;
  /** 描画色 hex (#rrggbb) */
  color: string;
  /** スタンプ間隔 % of size（1-200） */
  spacing: number;
  /** 縦横比 1-100（100=正円、50=半分の楕円） */
  roundness: number;
  /** 回転角度 -180..180 度 */
  angle: number;
  /** サイズのランダム変動 0-100% */
  sizeJitter: number;
  /** スタンプ位置の散布 0-100% */
  scatter: number;
  /** 流量のランダム変動 0-100% */
  flowJitter: number;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  let h = hex.replace('#', '').trim();
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h.slice(0, 6) || '000000', 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

/** ブラシ1スタンプを描く。硬さに応じて中心の不透明コア→透明縁のグラデにする。
 *  roundness/angle でブラシ形状を変形。sizeJitter/scatter/flowJitter でダイナミクスを適用。 */
export function stampBrush(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  p: BrushParams,
): void {
  // ダイナミクス: ランダム変動
  const jitterFactor = p.sizeJitter > 0 ? Math.max(0.01, 1 - (p.sizeJitter / 100) * Math.random()) : 1;
  const effectiveSize = p.size * jitterFactor;
  const r = Math.max(0.5, effectiveSize / 2);

  const flowJitterFactor = p.flowJitter > 0 ? Math.max(0, 1 - (p.flowJitter / 100) * Math.random()) : 1;
  const effectiveFlow = p.flow * flowJitterFactor;

  const scatterAmt = p.scatter > 0 ? (p.scatter / 100) * p.size : 0;
  const fx = x + (scatterAmt > 0 ? scatterAmt * (Math.random() - 0.5) : 0);
  const fy = y + (scatterAmt > 0 ? scatterAmt * (Math.random() - 0.5) : 0);

  const { r: cr, g: cg, b: cb } = hexToRgb(p.color);
  const a = Math.max(0, Math.min(1, effectiveFlow / 100));
  const core = Math.max(0, Math.min(0.98, p.hardness / 100));
  const solid = `rgba(${cr},${cg},${cb},${a})`;
  const transparent = `rgba(${cr},${cg},${cb},0)`;

  const roundness = p.roundness ?? 100;
  const angle = p.angle ?? 0;

  if (roundness >= 100 && angle === 0) {
    // 最速パス: 円形ブラシ（変形なし）
    const grad = ctx.createRadialGradient(fx, fy, 0, fx, fy, r);
    grad.addColorStop(0, solid);
    if (core > 0) grad.addColorStop(core, solid);
    grad.addColorStop(1, transparent);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(fx, fy, r, 0, Math.PI * 2);
    ctx.fill();
  } else {
    // 楕円・回転ブラシ: 変形した座標空間でグラデ+円を描く
    ctx.save();
    ctx.translate(fx, fy);
    ctx.rotate((angle * Math.PI) / 180);
    ctx.scale(1, Math.max(0.01, roundness) / 100);
    // 変換済み座標系でグラデーションと円を定義
    const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
    grad.addColorStop(0, solid);
    if (core > 0) grad.addColorStop(core, solid);
    grad.addColorStop(1, transparent);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

/** ブラシのスタンプ間隔。spacing は size に対する割合(%) */
export function brushSpacing(size: number, spacingPct: number = 15): number {
  return Math.max(1, size * (spacingPct / 100));
}

/**
 * 2点間を等間隔でスタンプ補間する。`carry` は前セグメントの余り距離。
 * 次セグメントへ渡す余り距離を返す（連続ストロークの均一スペーシング維持）。
 */
export function strokeSegment(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  p: BrushParams,
  carry: number,
): number {
  const spacing = brushSpacing(p.size, p.spacing);
  const dx = x1 - x0;
  const dy = y1 - y0;
  const dist = Math.hypot(dx, dy);
  if (dist === 0) return carry;
  let d = carry;
  while (d <= dist) {
    const t = d / dist;
    stampBrush(ctx, x0 + dx * t, y0 + dy * t, p);
    d += spacing;
  }
  return d - dist;
}
