// お試し版（トライアル）の書き出し制限を一元管理する。
// 方式＝解像度キャップ：編集・全機能はフル無制限だが、ファイル書き出し時だけ
// 長辺を TRIAL_MAX_DIM に収める。AI は「無い解像度」を復元できないため、
// 透かしより頑健にお試し版を本番使用不可にできる（製品版で解除）。

/** ビルド時フラグ。`LLAB_TRIAL=1` でビルドした版だけ true。 */
export const IS_TRIAL: boolean = __LLAB_TRIAL__;

/** お試し版の書き出し長辺上限(px)。調整はこの定数1個で完結。 */
export const TRIAL_MAX_DIM = 512;

/**
 * 希望出力サイズ(px)に対し、お試し版なら長辺を TRIAL_MAX_DIM に収める倍率を返す。
 * 製品版、または既に上限以下なら 1（等倍＝無変更）。
 * pixelRatio に乗算するだけで単発・一括どちらの書き出しにも効かせられる。
 */
export function trialScale(outW: number, outH: number): number {
  if (!IS_TRIAL) return 1;
  const longest = Math.max(outW, outH);
  if (longest <= TRIAL_MAX_DIM) return 1;
  return TRIAL_MAX_DIM / longest;
}
