// ブラウザ(Electron renderer)向け Node `util` の最小スタブ。
// ag-psd のデバッグ専用コード（abr.js の ABR 読込、additionalInfo.js の MOCK_HANDLERS 配下）
// が `require('util').inspect(...)` を参照しており、これらは実行時には到達しないが、
// Vite の依存最適化(esbuild/browser)が静的 require を解決できず
// "Could not resolve util" でビルドに失敗する。util をこのスタブへ alias して回避する。
export function inspect(): string {
  return '';
}

export default { inspect };
