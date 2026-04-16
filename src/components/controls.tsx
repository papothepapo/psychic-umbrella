import type { ReactNode } from 'react';
import { clamp } from '../lib/settings';

export function EditorToolbarButton({
  label,
  title,
  onClick,
  active = false
}: {
  label: string;
  title?: string;
  onClick: () => void;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      className={`toolbar-button${active ? ' active' : ''}`}
      aria-pressed={active}
      title={title ?? label}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

export function SettingRow({
  label,
  description,
  stacked = false,
  children
}: {
  label: string;
  description?: string;
  stacked?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={`setting-row${stacked ? ' stacked' : ''}`}>
      <div className="setting-copy">
        <div className="setting-label">{label}</div>
        {description ? <div className="setting-description">{description}</div> : null}
      </div>
      <div className="setting-control">{children}</div>
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  label
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
}) {
  return (
    <button
      type="button"
      className={`toggle${checked ? ' checked' : ''}`}
      aria-pressed={checked}
      onClick={() => onChange(!checked)}
    >
      <span className="toggle-thumb" />
      {label ? <span>{label}</span> : null}
    </button>
  );
}

export function NumberStepper({
  value,
  min,
  max,
  step = 1,
  onChange
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="stepper">
      <button type="button" onClick={() => onChange(clamp(value - step, min, max))}>
        -
      </button>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(event) => onChange(clamp(Number(event.target.value || value), min, max))}
      />
      <button type="button" onClick={() => onChange(clamp(value + step, min, max))}>
        +
      </button>
    </div>
  );
}
