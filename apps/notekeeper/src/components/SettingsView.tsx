import React, { useState } from 'react';
import { CompletionStyle, ItemCheckbox } from './ItemCheckbox';

interface SettingsViewProps {
  currentStyle: CompletionStyle;
  onSelectStyle: (style: CompletionStyle) => void;
  onBack: () => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  currentStyle,
  onSelectStyle,
  onBack,
}) => {
  const [previewCompleted, setPreviewCompleted] = useState(false);

  const stylesList: { id: CompletionStyle; label: string; desc: string }[] = [
    {
      id: 'pop',
      label: 'Pop',
      desc: 'Check draws in with a brief scale emphasis, followed by strikethrough.',
    },
    {
      id: 'sweep',
      label: 'Sweep',
      desc: 'A strike smoothly sweeps left-to-right across the row with soft fade.',
    },
    {
      id: 'minimal',
      label: 'Minimal',
      desc: 'Clean check mark draw only, no strikethrough; the row softly dims.',
    },
  ];

  return (
    <div data-testid="settings-view">
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: '16px' }}>
        <button
          type="button"
          data-testid="settings-back-btn"
          className="btn btn-secondary btn-sm"
          onClick={onBack}
        >
          ‹ Back
        </button>
      </div>

      <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '6px', letterSpacing: '-0.02em' }}>
        Settings
      </h1>
      <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)', marginBottom: '20px' }}>
        Customize your experience
      </p>

      {/* Completion Style Preference */}
      <div className="card" style={{ padding: '18px 20px', marginBottom: '16px' }}>
        <h2 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '4px' }}>
          Completion Style
        </h2>
        <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', marginBottom: '16px' }}>
          Choose the visual animation style when completing tasks and todos.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '20px' }}>
          {stylesList.map((item) => {
            const isSelected = currentStyle === item.id;
            return (
              <label
                key={item.id}
                data-testid={`option-style-${item.id}`}
                className="card card-interactive"
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '12px',
                  padding: '12px 14px',
                  margin: 0,
                  cursor: 'pointer',
                  borderColor: isSelected ? 'var(--accent-violet)' : 'var(--border-color)',
                  background: isSelected ? 'var(--accent-violet-bg)' : 'var(--bg-card)',
                }}
              >
                <input
                  type="radio"
                  name="completion_style"
                  value={item.id}
                  checked={isSelected}
                  onChange={() => onSelectStyle(item.id)}
                  style={{ marginTop: '3px', accentColor: 'var(--accent-violet)' }}
                />
                <div>
                  <div style={{ fontWeight: 600, fontSize: '0.9375rem', color: 'var(--text-main)' }}>
                    {item.label}
                  </div>
                  <div style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                    {item.desc}
                  </div>
                </div>
              </label>
            );
          })}
        </div>

        {/* Live Interactive Preview */}
        <div>
          <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '8px' }}>
            Live Preview (tap to test)
          </div>
          <div
            data-testid="settings-preview-row"
            data-completion-style={currentStyle}
            className={`item-row ${previewCompleted ? 'is-completed' : ''} style-${currentStyle} completion-style-${currentStyle}`}
            onClick={() => setPreviewCompleted(!previewCompleted)}
            style={{ margin: 0 }}
          >
            <ItemCheckbox
              checked={previewCompleted}
              onChange={() => setPreviewCompleted(!previewCompleted)}
              completionStyle={currentStyle}
              ariaLabel="Preview checkbox"
            />
            <div className="item-row-content">
              <div className={`item-row-title ${previewCompleted ? 'completed' : ''}`}>
                Review launch telemetry data
              </div>
              <div className="item-row-snippet">
                Interactive preview demonstrating the {currentStyle} completion animation.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
