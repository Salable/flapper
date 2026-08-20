'use client';

/** Label + control + hint, the unit every form is built from. */
export function Field({
  label,
  hint,
  htmlFor,
  children,
}: {
  label?: React.ReactNode;
  hint?: React.ReactNode;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="ui-field">
      {label !== undefined && (
        <label className="ui-label" htmlFor={htmlFor}>
          {label}
        </label>
      )}
      {children}
      {hint !== undefined && <span className="ui-hint">{hint}</span>}
    </div>
  );
}

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input type="text" className="ui-input" {...props} />;
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className="ui-input ui-select" {...props} />;
}

export function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className="ui-input ui-textarea" {...props} />;
}

export function RangeSlider(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input type="range" className="ui-range" {...props} />;
}

export function Checkbox({
  label,
  ...rest
}: React.InputHTMLAttributes<HTMLInputElement> & { label: React.ReactNode }) {
  return (
    <label className="ui-checkbox">
      <input type="checkbox" {...rest} /> {label}
    </label>
  );
}
