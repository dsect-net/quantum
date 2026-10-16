import React from 'react';
import {
  getTodayString,
  getTomorrowString,
  getNextWeekString,
} from '../date';

export interface DueDatePickerProps {
  value: string; // YYYY-MM-DD or empty string
  onChange: (value: string | null) => void;
  testId?: string;
  id?: string;
}

export const DueDatePicker: React.FC<DueDatePickerProps> = ({
  value,
  onChange,
  testId = 'item-due-input',
  id,
}) => {
  const todayStr = getTodayString();
  const tomorrowStr = getTomorrowString();
  const nextWeekStr = getNextWeekString();

  const isNoDate = !value;
  const isTodayActive = value === todayStr;
  const isTomorrowActive = value === tomorrowStr;
  const isNextWeekActive = value === nextWeekStr;

  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '8px' }}>
        <button
          type="button"
          data-testid="due-chip-no-date"
          className={`btn btn-sm ${isNoDate ? 'btn-black' : 'btn-secondary'}`}
          style={{ padding: '4px 10px', fontSize: '0.75rem', borderRadius: 'var(--radius-pill)' }}
          onClick={() => onChange(null)}
        >
          No date
        </button>
        <button
          type="button"
          data-testid="due-chip-today"
          className={`btn btn-sm ${isTodayActive ? 'btn-black' : 'btn-secondary'}`}
          style={{ padding: '4px 10px', fontSize: '0.75rem', borderRadius: 'var(--radius-pill)' }}
          onClick={() => onChange(todayStr)}
        >
          Today
        </button>
        <button
          type="button"
          data-testid="due-chip-tomorrow"
          className={`btn btn-sm ${isTomorrowActive ? 'btn-black' : 'btn-secondary'}`}
          style={{ padding: '4px 10px', fontSize: '0.75rem', borderRadius: 'var(--radius-pill)' }}
          onClick={() => onChange(tomorrowStr)}
        >
          Tomorrow
        </button>
        <button
          type="button"
          data-testid="due-chip-next-week"
          className={`btn btn-sm ${isNextWeekActive ? 'btn-black' : 'btn-secondary'}`}
          style={{ padding: '4px 10px', fontSize: '0.75rem', borderRadius: 'var(--radius-pill)' }}
          onClick={() => onChange(nextWeekStr)}
        >
          Next week
        </button>
      </div>

      <input
        id={id}
        type="date"
        data-testid={testId}
        className="form-input"
        value={value}
        onChange={(e) => onChange(e.target.value ? e.target.value : null)}
      />
    </div>
  );
};
