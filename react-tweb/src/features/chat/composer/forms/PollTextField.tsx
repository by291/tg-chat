import { useId, useRef, type RefObject } from 'react';
import { TextFieldEmojiButton } from '../picker/TextFieldEmojiButton';
import styles from './ComposerListDialog.module.css';

interface PollTextFieldProps {
  label: string;
  value: string;
  maxLength: number;
  onChange: (value: string) => void;
  isMultiline?: boolean;
  inputRef?: RefObject<HTMLInputElement | null>;
  className?: string;
}

/** Share Telegram's floating label, focus border, and emoji affordance across poll text fields. */
export function PollTextField({
  label,
  value,
  maxLength,
  onChange,
  isMultiline = false,
  inputRef,
  className = '',
}: PollTextFieldProps) {
  const id = useId();
  const singleLineRef = useRef<HTMLInputElement>(null);
  const multilineRef = useRef<HTMLTextAreaElement>(null);
  const resolvedInputRef = inputRef ?? singleLineRef;

  return (
    <div
      className={`${styles.floatingField} ${className}`}
      data-filled={Boolean(value)}
      onClick={(event) => {
        if (event.target !== event.currentTarget) {
          return;
        }
        const input = isMultiline ? multilineRef.current : resolvedInputRef.current;
        input?.focus();
      }}
    >
      {isMultiline ? (
        <textarea
          ref={multilineRef}
          id={id}
          className={styles.floatingInput}
          aria-label={label}
          value={value}
          maxLength={maxLength}
          rows={1}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : (
        <input
          ref={resolvedInputRef}
          id={id}
          className={styles.floatingInput}
          aria-label={label}
          value={value}
          maxLength={maxLength}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
      <label htmlFor={id} className={styles.floatingLabel}>
        {label}
      </label>
      <TextFieldEmojiButton
        label={`Emoji for ${label}`}
        getInput={() => (isMultiline ? multilineRef.current : resolvedInputRef.current)}
        onChange={onChange}
      />
    </div>
  );
}
