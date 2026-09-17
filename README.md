<p align="center">
  <img src="public/icon.png" width="128" height="128" alt="LayerLab icon" />
</p>

<h1 align="center">LayerLab</h1>

<p align="center">
  Windows向けのオフライン画像・テクスチャ編集デスクトップアプリ。
</p>

LayerLabは、画像・サムネイル・Unity / VRChat向けテクスチャの編集に必要な機能を、Photoshopに近い操作感でまとめる個人開発プロジェクトです。Electron、React、TypeScript、Konvaで構築しています。

## 主な機能

- レイヤー、グループ、複数選択、ブレンドモード、クリッピング
- テキスト、図形、ブラシ、消しゴム、選択範囲、切り抜き
- PSD / PSBの読み込みとLayerLab独自形式での保存
- チャンネルパッカー、ノーマルマップ、PBRマップ、タイル確認
- Photoshop系ショートカットを意識した操作
- 日本語 / 英語UI、オフライン動作

## 開発環境

- Electron 33
- React 18
- TypeScript 5
- Vite 6
- Konva / react-konva
- Zustand / Zundo / Immer

## セットアップ

Node.js 22以降とnpmを用意してください。

```bash
npm ci
npm run dev
```

## 確認コマンド

```bash
npm test
npm run build
```

## 状態

現在も開発中です。公開されているソースは、その時点の開発スナップショットです。配布用バイナリ、ユーザーが編集した画像・PSD・LayerLab形式の制作データはリポジトリに含めません。

## Third-party assets

同梱フォントの出典とライセンスは [public/THIRD_PARTY_FONTS.txt](public/THIRD_PARTY_FONTS.txt) を参照してください。各npm依存パッケージには、それぞれのライセンスが適用されます。

## License

Copyright © 2026 Mild Solt. All rights reserved.

このソースコードは、制作実績と実装内容を確認できるよう公開しています。別途ライセンスが明示された第三者コンポーネントを除き、再配布、改変版の配布、販売、商用利用を許諾するオープンソースライセンスは付与していません。
