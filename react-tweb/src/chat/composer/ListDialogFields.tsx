import { Switch } from '@ark-ui/react/switch';
import { Menu, Plus } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useId, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { TextFieldEmojiButton } from './TextFieldEmojiButton';
import { PollCorrectAnswer } from './PollCorrectAnswer';
import { FormListRow } from './FormListRow';
import { Ripple } from '../../components/Ripple';
import { createListEntry, MIN_POLL_OPTIONS, type ListEntry } from './listComposition';
import styles from './ComposerListDialog.module.css';

const NEW_OPTION_BOTTOM_GAP = 8;
const OPTION_ICON_TRANSITION_SECONDS = 0.12;

interface ListEntryFieldsProps {
  entries: ListEntry[];
  onChange: (entries: ListEntry[]) => void;
  maximum: number;
  maxLength: number;
  correctOptionIds?: string[];
  canChooseMultiple: boolean;
  scrollContainerRef: RefObject<HTMLDivElement | null>;
  onCorrectAnswer: (id: string) => void;
}

/** Render poll answers with stable focus, bounded additions, and animated sorting controls. */
export function ListEntryFields({
  entries,
  onChange,
  maximum,
  maxLength,
  correctOptionIds,
  canChooseMultiple,
  scrollContainerRef,
  onCorrectAnswer,
}: ListEntryFieldsProps) {
  const inputs = useRef(new Map<string, HTMLInputElement>());
  const draggedId = useRef<string | undefined>(undefined);
  const answerGroupName = useId();
  const previousEntryCount = useRef(entries.length);
  const pendingRevealId = useRef<string | undefined>(undefined);
  const [isDragging, setIsDragging] = useState(false);
  const shouldReduceMotion = useReducedMotion();

  useLayoutEffect(() => {
    const hasAddedEntry = entries.length > previousEntryCount.current;
    previousEntryCount.current = entries.length;
    const lastEntry = entries.at(-1);
    if (!hasAddedEntry || !lastEntry) {
      return;
    }
    pendingRevealId.current = lastEntry.id;
  }, [entries]);

  function revealAddedEntry(id: string) {
    const scrollContainer = scrollContainerRef.current;
    if (pendingRevealId.current !== id || !scrollContainer) {
      return;
    }
    pendingRevealId.current = undefined;
    const input = inputs.current.get(id);
    if (!input || scrollContainer.clientHeight === 0) {
      return;
    }
    const inputBottom = input.getBoundingClientRect().bottom;
    const viewportBottom = scrollContainer.getBoundingClientRect().bottom;
    const overflow = inputBottom + NEW_OPTION_BOTTOM_GAP - viewportBottom;
    if (overflow <= 0) {
      return;
    }

    // Reveal the new row without moving the caret or scrolling the page behind the modal.
    scrollContainer.scrollBy({
      top: overflow,
      behavior: shouldReduceMotion ? 'instant' : 'smooth',
    });
  }

  function updateEntry(id: string, text: string) {
    const next = entries.map((entry) => (entry.id === id ? { ...entry, text } : entry));
    const lastEntry = next.at(-1);
    if (lastEntry?.text.trim() && next.length < maximum) {
      next.push(createListEntry());
    }
    onChange(next);
  }

  function addEntry() {
    if (entries.length >= maximum) {
      return;
    }
    const entry = createListEntry();
    onChange([...entries, entry]);
    // Wait for React to mount the new input before moving the caret into it.
    requestAnimationFrame(() => inputs.current.get(entry.id)?.focus());
  }

  function moveEntry(sourceId: string, targetId: string) {
    const sourceIndex = entries.findIndex((entry) => entry.id === sourceId);
    const targetIndex = entries.findIndex((entry) => entry.id === targetId);
    if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) {
      return;
    }
    const next = [...entries];
    const [movedEntry] = next.splice(sourceIndex, 1);
    next.splice(targetIndex, 0, movedEntry);
    onChange(next);
  }

  return (
    <div className={styles.entries} data-kind="poll" data-dragging={isDragging}>
      <AnimatePresence initial={false}>
        {entries.map((entry, index) => {
          const isTrailingOption = index === entries.length - 1 && !entry.text;
          const isInitialEmptyOption =
            entries.length === MIN_POLL_OPTIONS && index === 0 && !entry.text;
          const canReorder = !isTrailingOption && !isInitialEmptyOption;
          const shouldShowEmoji = !isTrailingOption || Boolean(entries[0]?.text);
          const shouldFocusFirstOption =
            isTrailingOption && entries.length === MIN_POLL_OPTIONS && !entries[0].text;
          const isDuplicate =
            Boolean(entry.text) &&
            entries.some((other) => {
              return other.id !== entry.id && other.text === entry.text;
            });
          const fieldName = `Option ${index + 1}`;
          return (
            <FormListRow
              key={entry.id}
              hasGap={index > 0}
              onRevealComplete={() => revealAddedEntry(entry.id)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                if (draggedId.current) {
                  moveEntry(draggedId.current, entry.id);
                  draggedId.current = undefined;
                  setIsDragging(false);
                }
              }}
            >
              {correctOptionIds && (
                <div className={styles.answerSlot}>
                  {canReorder && (
                    <PollCorrectAnswer
                      label={`Correct answer ${index + 1}`}
                      groupName={answerGroupName}
                      isChecked={correctOptionIds.includes(entry.id)}
                      canChooseMultiple={canChooseMultiple}
                      onSelect={() => onCorrectAnswer(entry.id)}
                    />
                  )}
                </div>
              )}
              <div className={styles.entry} data-invalid={isDuplicate}>
                <button
                  type="button"
                  className={styles.reorder}
                  aria-label={`Reorder option ${index + 1}`}
                  aria-hidden={!canReorder}
                  disabled={!canReorder}
                  draggable={canReorder}
                  onDragStart={() => {
                    draggedId.current = entry.id;
                    setIsDragging(true);
                  }}
                  onDragEnd={() => {
                    draggedId.current = undefined;
                    setIsDragging(false);
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') {
                      return;
                    }
                    event.preventDefault();
                    const offset = event.key === 'ArrowUp' ? -1 : 1;
                    const target = entries[index + offset];
                    if (target) {
                      moveEntry(entry.id, target.id);
                    }
                  }}
                >
                  <AnimatePresence initial={false}>
                    {!isInitialEmptyOption && (
                      <motion.span
                        key={isTrailingOption ? 'add' : 'reorder'}
                        className={styles.optionGlyph}
                        initial={{ scale: 0, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        exit={{ scale: 0, opacity: 0 }}
                        transition={{
                          duration: shouldReduceMotion ? 0 : OPTION_ICON_TRANSITION_SECONDS,
                          ease: 'easeOut',
                        }}
                      >
                        {isTrailingOption ? <Plus size={20} /> : <Menu size={20} />}
                      </motion.span>
                    )}
                  </AnimatePresence>
                </button>
                <input
                  ref={(element) => {
                    if (element) {
                      inputs.current.set(entry.id, element);
                    } else {
                      inputs.current.delete(entry.id);
                    }
                  }}
                  data-list-entry
                  aria-label={fieldName}
                  placeholder={isTrailingOption ? 'Add an Option' : 'Option'}
                  value={entry.text}
                  maxLength={maxLength}
                  onFocus={() => {
                    if (shouldFocusFirstOption) {
                      inputs.current.get(entries[0].id)?.focus();
                    }
                  }}
                  onChange={(event) => updateEntry(entry.id, event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Backspace' && !entry.text) {
                      event.preventDefault();
                      const previousEntry = entries[Math.max(0, index - 1)];
                      if (entries.length > MIN_POLL_OPTIONS && !isTrailingOption) {
                        onChange(entries.filter((item) => item.id !== entry.id));
                      }
                      inputs.current.get(previousEntry.id)?.focus();
                      return;
                    }
                    if (event.key !== 'Enter') {
                      return;
                    }
                    event.preventDefault();
                    const nextEntry = entries[index + 1];
                    if (nextEntry) {
                      inputs.current.get(nextEntry.id)?.focus();
                    } else {
                      addEntry();
                    }
                  }}
                />
                {shouldShowEmoji && (
                  <TextFieldEmojiButton
                    label={`Emoji for option ${index + 1}`}
                    getInput={() => inputs.current.get(entry.id)}
                    onChange={(text) => updateEntry(entry.id, text)}
                  />
                )}
              </div>
            </FormListRow>
          );
        })}
      </AnimatePresence>
    </div>
  );
}

/** Keep a settings row's label, switch state, and pointer feedback in one accessible control. */
export function ListSetting({
  title,
  description,
  icon,
  color,
  isChecked,
  isDisabled,
  onChange,
}: {
  title: string;
  description?: string;
  icon?: ReactNode;
  color?: string;
  isChecked: boolean;
  isDisabled?: boolean;
  onChange: (isChecked: boolean) => void;
}) {
  return (
    <Switch.Root
      className={styles.setting}
      checked={isChecked}
      disabled={isDisabled}
      onCheckedChange={({ checked }) => onChange(checked)}
    >
      {icon && (
        <span className={styles.settingIcon} style={{ background: color }}>
          {icon}
        </span>
      )}
      <span className={styles.settingText}>
        <Switch.Label>{title}</Switch.Label>
        {description && <span className={styles.settingDescription}>{description}</span>}
      </span>
      <Switch.Control className={styles.switchTrack}>
        <Switch.Thumb className={styles.switchThumb} />
      </Switch.Control>
      <Switch.HiddenInput />
      <Ripple />
    </Switch.Root>
  );
}
