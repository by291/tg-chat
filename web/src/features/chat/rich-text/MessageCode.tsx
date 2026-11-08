import { Copy, Menu } from 'lucide-react';
import { useEffect, useState } from 'react';
import { copyTextWithToast } from '@/components/copyTextWithToast';
import { getCodeLanguageHint, getCodeLanguageLabel } from '@/lib/codeLanguages';
import styles from './MessageCode.module.css';

interface MessageCodeProps {
  source: string;
  language?: string;
}

interface HighlightedSource {
  source: string;
  language?: string;
  html?: string;
  detectedLanguage?: string;
}

/** Render one code source with syntax highlighting, wrapping, and lossless copying. */
export function MessageCode({ source, language }: MessageCodeProps) {
  const [shouldWrap, setShouldWrap] = useState(true);
  const [highlighted, setHighlighted] = useState<HighlightedSource>();
  const hasCurrentHighlight = highlighted?.source === source && highlighted.language === language;
  const html = hasCurrentHighlight ? highlighted.html : undefined;
  const detectedLanguage = hasCurrentHighlight ? highlighted.detectedLanguage : undefined;
  const languageHint = language ? undefined : getCodeLanguageHint(source);
  const label = getCodeLanguageLabel(language || languageHint || detectedLanguage) ?? 'Copy Code';

  useEffect(() => {
    let isCurrent = true;
    // Keep the plain source in place while the highlighter loads; its geometry never disappears.
    void import('./highlightMessageCode')
      .then(async ({ highlightMessageCode }) => {
        const highlightedHtml = await highlightMessageCode({ source, language });
        if (isCurrent) {
          setHighlighted({
            source,
            language,
            html: highlightedHtml?.html,
            detectedLanguage: highlightedHtml?.language,
          });
        }
      })
      .catch(() => {
        // Unsupported grammars or unavailable chunks leave the original source readable.
      });

    return () => {
      isCurrent = false;
    };
  }, [source, language]);

  function copyCode() {
    return copyTextWithToast({
      text: source,
      successMessage: 'Code copied to clipboard',
      errorMessage: 'Could not copy code',
    });
  }

  return (
    <div className={styles.code} data-wrap={shouldWrap}>
      <div className={styles.header}>
        <button
          type="button"
          className={styles.name}
          onClick={(event) => {
            event.stopPropagation();
            void copyCode();
          }}
          aria-label={`Copy ${label === 'Copy Code' ? 'code block' : `${label} code`}`}
        >
          {label}
        </button>
        <button
          type="button"
          className={styles.control}
          aria-label="Wrap lines"
          aria-pressed={shouldWrap}
          title={shouldWrap ? 'Disable line wrapping' : 'Enable line wrapping'}
          onClick={(event) => {
            event.stopPropagation();
            setShouldWrap((current) => !current);
          }}
        >
          <Menu size={16} aria-hidden="true" />
        </button>
        <button
          type="button"
          className={styles.control}
          aria-label="Copy code"
          title="Copy code"
          onClick={(event) => {
            event.stopPropagation();
            void copyCode();
          }}
        >
          <Copy size={16} aria-hidden="true" />
        </button>
      </div>
      <pre className={styles.content} dir="ltr">
        {html ? (
          // Prism escapes source before adding spans; saved HTML never reaches this sink.
          <code dangerouslySetInnerHTML={{ __html: html }} />
        ) : (
          <code>{source}</code>
        )}
      </pre>
    </div>
  );
}
