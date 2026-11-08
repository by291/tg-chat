import styles from './MessageCheckbox.module.css';

/** Animate the filled disc and drawn mark independently inside a message control. */
export function MessageCheckbox({
  isChecked,
  isRound = true,
  isCross = false,
}: {
  isChecked: boolean;
  isRound?: boolean;
  isCross?: boolean;
}) {
  return (
    <span
      className={styles.checkbox}
      data-checked={isChecked}
      data-round={isRound}
      aria-hidden="true"
    >
      <span className={styles.border} />
      <span className={styles.fill} />
      <svg className={styles.mark} viewBox="0 0 24 24" fill="none">
        <path
          d={
            isCross
              ? 'M6 6L18 18M18 6L6 18'
              : 'M4.7071 12.2929l5 5c0.3905 0.3905 1.0237 0.3905 1.4142 0l11 -11'
          }
          transform={isCross ? undefined : 'translate(-1 0)'}
          pathLength="1"
        />
      </svg>
    </span>
  );
}
