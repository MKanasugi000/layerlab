// dist/ の全ファイルを走査して version.json（バージョン＋各ファイルの sha256）を生成する。
// 軽量アップデータ（electron/main.ts）が「同梱版 vs 配信版」の新旧判定と整合検証に使う。
// vite build の後・electron-builder の前に実行する。
import { readdirSync, statSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

const distDir = path.resolve('dist');

function walk(dir, base = '') {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    const rel = base ? `${base}/${name}` : name;
    if (statSync(full).isDirectory()) out.push(...walk(full, rel));
    else if (rel !== 'version.json') out.push(rel);
  }
  return out;
}

const files = walk(distDir).map((rel) => {
  const buf = readFileSync(path.join(distDir, rel));
  return { path: rel.replace(/\\/g, '/'), sha256: createHash('sha256').update(buf).digest('hex') };
});

// 単調増加するビルド番号（環境変数で固定も可能）。大きいほど新しい。
const version = Number(process.env.LLAB_BUILD_VERSION) || Date.now();
const out = { version, files };
writeFileSync(path.join(distDir, 'version.json'), JSON.stringify(out));
console.log(`version.json: v${version} / ${files.length} files`);
