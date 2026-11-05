import styles from './MessageBubble.module.css';

/** Draw the original tweb tail, mirrored by the outgoing bubble's CSS. */
export function MessageTail() {
  return (
    <svg className={styles.tail} viewBox="0 0 11 20" aria-hidden="true">
      <g transform="translate(9 -14)" fillRule="evenodd">
        <path
          d="M-6 16h6v17c-.193-2.84-.876-5.767-2.05-8.782-.904-2.325-2.446-4.485-4.625-6.48A1 1 0 01-6 16z"
          transform="matrix(1 0 0 -1 0 49)"
        />
      </g>
    </svg>
  );
}
