import { useState } from 'react';
import { ColorPickerDialog } from './ColorPickerDialog';
import { useT } from '../i18n/locale';

interface Props {
  value: string;
  onChange: (hex: string) => void;
  title?: string;
  className?: string;
  /** チェッカー背景を出す（透過色対応の見た目） */
  size?: 'sm' | 'md' | 'lg';
}

/** クリックで Adobe 風カラーピッカーを開くスウォッチボタン。 */
export function ColorButton({ value, onChange, title, className, size = 'md' }: Props) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const display = value && value.startsWith('#') ? value : '#000000';
  return (
    <>
      <button
        type="button"
        className={`color-button cb-${size} ${className ?? ''}`}
        title={title ?? t({ ja: 'クリックで色を選択', en: 'Click to select color' })}
        onClick={() => setOpen(true)}
      >
        <span className="color-button-chip" style={{ background: display }} />
      </button>
      {open && (
        <ColorPickerDialog
          initial={display}
          title={title}
          onApply={onChange}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}