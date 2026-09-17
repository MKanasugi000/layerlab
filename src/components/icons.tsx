/**
 * 統一ツールアイコンセット（線画SVG）。
 * 絵文字/記号混在をやめ、単一の線幅・グリッド(24)・currentColor で統一する。
 * 根拠: ゲシュタルト類同 / 認識>想起 / 美的ユーザビリティ効果（UX心理リサーチ P0）。
 */

export type IconName =
  | 'move'
  | 'marquee-rect'
  | 'marquee-ellipse'
  | 'lasso'
  | 'wand'
  | 'brush'
  | 'eraser'
  | 'text'
  | 'shape-rect'
  | 'shape-ellipse'
  | 'shape-line'
  | 'crop'
  | 'eyedropper'
  | 'hand'
  | 'zoom'
  | 'fit'
  | 'swap'
  | 'reset-colors';

const PATHS: Record<IconName, JSX.Element> = {
  move: (
    <>
      <path d="M12 4v16M4 12h16" />
      <path d="M12 4 9.6 6.4M12 4l2.4 2.4" />
      <path d="M12 20 9.6 17.6M12 20l2.4-2.4" />
      <path d="M4 12l2.4-2.4M4 12l2.4 2.4" />
      <path d="M20 12l-2.4-2.4M20 12l-2.4 2.4" />
    </>
  ),
  'marquee-rect': <rect x="3.5" y="3.5" width="17" height="17" rx="1.5" strokeDasharray="3 2.2" />,
  'marquee-ellipse': <circle cx="12" cy="12" r="8.5" strokeDasharray="3 2.2" />,
  lasso: (
    <>
      <path d="M4 13.5 11 4l8.5 3.5L15.5 18Z" />
      <circle cx="4" cy="13.5" r="1.4" fill="currentColor" stroke="none" />
    </>
  ),
  wand: (
    <>
      <path d="M5 19 14 10" />
      <path d="M16.5 3.5l1 2.2 2.2 1-2.2 1-1 2.2-1-2.2-2.2-1 2.2-1z" />
      <path d="M6.6 5.4l.5 1.1 1.1.5-1.1.5-.5 1.1-.5-1.1L4.5 7l1.1-.5z" />
    </>
  ),
  brush: (
    <>
      <path d="M17 3.5c1.6 1.2 2.2 3 1 4.8l-5.4 7.2-3.6-2.7L14 5.2c1.3-1.7 1.5-2.6 3-1.7z" />
      <path d="M9 12.8c-1.7.3-2.6 1.5-3 3-.3 1.2-.7 1.8-2 2.2 1 1.3 2.7 2 4.3 1.6 1.9-.5 3-2.2 2.6-4-.3-1.3-1.4-2.4-2.7-2.5z" />
    </>
  ),
  eraser: (
    <>
      <path d="m14.8 4.2 5 5a2 2 0 0 1 0 2.8l-7.2 7.2H7.8l-3.6-3.6a2 2 0 0 1 0-2.8l7.8-8.6a2 2 0 0 1 2.8 0Z" />
      <path d="m8.2 9.8 6 6M7.8 19.2H21" />
    </>
  ),
  text: <path d="M5 5h14M5 5v2.5M19 5v2.5M12 5v14M9 19h6" />,
  'shape-rect': <rect x="4" y="6.5" width="16" height="11" rx="1.4" />,
  'shape-ellipse': <ellipse cx="12" cy="12" rx="8.5" ry="6.5" />,
  'shape-line': <path d="M5 19 19 5" />,
  crop: (
    <>
      <path d="M6 2v16h16" />
      <path d="M2 6h16v16" />
    </>
  ),
  eyedropper: (
    <>
      <path d="M4 20l.7-3 8-8" />
      <path d="M11.5 8.5l4 4" />
      <path d="M16 3.5a2.1 2.1 0 0 1 3 3l-2 2-3-3z" />
    </>
  ),
  hand: (
    <path d="M8 13V7a1.3 1.3 0 0 1 2.6 0v4m0-.5V6a1.3 1.3 0 0 1 2.6 0v5m0-.5V7.5a1.3 1.3 0 0 1 2.6 0v5.5a5.5 5.5 0 0 1-5.5 5.5h-1a5 5 0 0 1-3.5-1.5l-2.5-2.5a1.4 1.4 0 0 1 2-2l1.7 1.7" />
  ),
  zoom: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M20.5 20.5 16 16" />
      <path d="M11 8.2v5.6M8.2 11h5.6" />
    </>
  ),
  fit: (
    <path d="M4 9V5a1 1 0 0 1 1-1h4M15 4h4a1 1 0 0 1 1 1v4M20 15v4a1 1 0 0 1-1 1h-4M9 20H5a1 1 0 0 1-1-1v-4" />
  ),
  swap: (
    <>
      <path d="M5 8h11M5 8l3-3M5 8l3 3" />
      <path d="M19 16H8M19 16l-3-3M19 16l-3 3" />
    </>
  ),
  'reset-colors': (
    <>
      <rect x="4" y="4" width="11" height="11" rx="1.5" fill="currentColor" stroke="none" />
      <rect x="9" y="9" width="11" height="11" rx="1.5" fill="#fff" stroke="currentColor" />
    </>
  ),
};

export function ToolIcon({ name, size = 20 }: { name: IconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}
