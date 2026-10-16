import React, { useState } from 'react';
import { IconCheck } from './Icons';

export type CompletionStyle = 'pop' | 'sweep' | 'minimal';

export interface ItemCheckboxProps {
  checked: boolean;
  onChange: () => void;
  testId?: string;
  ariaLabel?: string;
  completionStyle?: CompletionStyle;
}

export const ItemCheckbox: React.FC<ItemCheckboxProps> = ({
  checked,
  onChange,
  testId,
  ariaLabel,
  completionStyle = 'pop',
}) => {
  const [animating, setAnimating] = useState(false);

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!checked) {
      setAnimating(true);
      setTimeout(() => setAnimating(false), 400);
    }
    onChange();
  };

  return (
    <label
      className={`item-checkbox-container ${checked ? 'checked' : ''} ${animating ? 'animating' : ''} style-${completionStyle}`}
      onClick={handleClick}
      aria-label={ariaLabel}
    >
      <input
        type="checkbox"
        data-testid={testId}
        className="item-checkbox-input"
        checked={checked}
        onChange={(e) => {
          e.stopPropagation();
          // Handled via container click or keyboard
          if (!checked) {
            setAnimating(true);
            setTimeout(() => setAnimating(false), 400);
          }
          onChange();
        }}
        aria-label={ariaLabel}
      />
      <span className="item-checkbox-visual" aria-hidden="true">
        <IconCheck size={12} className="item-checkbox-check" />
      </span>
    </label>
  );
};
