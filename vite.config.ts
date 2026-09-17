import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron/simple';
import { fileURLToPath } from 'node:url';

// お試し版ビルド判定。`LLAB_TRIAL=1` を付けてビルドすると書き出し解像度キャップが有効化される。
// renderer と electron main の双方に同じ即値を焼き込む（main は別 vite ビルドなので個別に define する）。
const TRIAL = process.env.LLAB_TRIAL === '1';
const trialDefine = { __LLAB_TRIAL__: JSON.stringify(TRIAL) };

export default defineConfig({
  define: trialDefine,
  resolve: {
    alias: {
      // ag-psd のデバッグ専用コードが参照する Node 組込み `util` を、
      // renderer(ブラウザ)向け空スタブへ解決する。これが無いと Vite の
      // 依存最適化(esbuild)が "Could not resolve util" で失敗し、
      // renderer で ag-psd を import できず PSD 読込が動かない。
      util: fileURLToPath(new URL('./src/shims/util-stub.ts', import.meta.url)),
    },
  },
  plugins: [
    react(),
    electron({
      main: {
        entry: 'electron/main.ts',
        vite: { define: trialDefine },
      },
      preload: {
        input: 'electron/preload.ts',
      },
      renderer: {},
    }),
  ],
});
