/// <reference types="vite/client" />

/**
 * お試し版フラグ。ビルド時に vite `define` で `true`/`false` の即値に置換される。
 * `LLAB_TRIAL=1` でビルドした時だけ true（書き出し解像度キャップ有効）。
 * 通常ビルド（製品版）では false = 無制限。
 */
declare const __LLAB_TRIAL__: boolean;
