import parse, {
  domToReact,
  Element,
  Text,
  type DOMNode,
  type HTMLReactParserOptions,
} from 'html-react-parser';
import { useMemo, useState, type ReactNode } from 'react';
import { MessageCode } from './MessageCode';
import { MessageQuote } from './MessageQuote';
import { CustomEmojiText } from '../emoji/CustomEmojiText';
import { sanitizeRichText } from './richText';
import { renderFormulaHtml } from './renderFormula';
import 'katex/dist/katex.min.css';
import styles from './RichMessageText.module.css';

function getContentNodes(element: Element): DOMNode[] {
  return element.children.filter((child): child is Element | Text => {
    return child instanceof Element || child instanceof Text;
  });
}

function getElementText(element: Element): string {
  if (element.name === 'br') {
    return '\n';
  }
  return getContentNodes(element)
    .map((child) => {
      if (child instanceof Text) {
        return child.data;
      }
      if (child instanceof Element) {
        return getElementText(child);
      }
      return '';
    })
    .join('');
}

function renderChildren(element: Element) {
  return domToReact(getContentNodes(element), parserOptions);
}

function Spoiler({ children }: { children: ReactNode }) {
  const [isRevealed, setIsRevealed] = useState(false);

  return (
    <span
      role="button"
      tabIndex={0}
      className={styles.spoiler}
      data-revealed={isRevealed}
      aria-label={isRevealed ? undefined : 'Reveal spoiler'}
      aria-expanded={isRevealed}
      onClick={(event) => {
        event.stopPropagation();
        setIsRevealed(true);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          event.stopPropagation();
          setIsRevealed(true);
        }
      }}
    >
      <span aria-hidden={!isRevealed} inert={!isRevealed}>
        {children}
      </span>
    </span>
  );
}

function Formula({ source, isBlock }: { source: string; isBlock: boolean }) {
  const html = useMemo(() => {
    return renderFormulaHtml({ source, isBlock });
  }, [source, isBlock]);

  // Only KaTeX's untrusted-mode output reaches this HTML sink; message HTML never does.
  return (
    <span
      className={styles.formula}
      data-display={isBlock ? 'block' : 'inline'}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

function renderRichElement(node: DOMNode) {
  if (!(node instanceof Element)) {
    return;
  }

  const documentId = node.attribs['data-custom-emoji'];
  if (documentId) {
    const text = getElementText(node);
    const customEmoji = [
      {
        documentId,
        offset: 0,
        length: text.length,
      },
    ];
    return <CustomEmojiText text={text} customEmoji={customEmoji} />;
  }
  if (node.attribs['data-spoiler'] === 'true') {
    return <Spoiler>{renderChildren(node)}</Spoiler>;
  }
  if (node.attribs['data-math']) {
    return (
      <Formula
        source={node.attribs['data-math']}
        isBlock={node.attribs['data-math-display'] === 'block'}
      />
    );
  }
  if (node.attribs['data-message-date']) {
    const date = new Date(Number(node.attribs['data-message-date']));
    return (
      <time className={styles.date} dateTime={date.toISOString()}>
        {date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
      </time>
    );
  }

  switch (node.name) {
    case 'a':
      return (
        <a href={node.attribs.href} target="_blank" rel="noopener noreferrer">
          {renderChildren(node)}
        </a>
      );
    case 'table':
      return (
        <div className={styles.tableScroll}>
          <table>{renderChildren(node)}</table>
        </div>
      );
    case 'pre':
      return (
        <MessageCode source={getElementText(node)} language={node.attribs['data-code-language']} />
      );
    case 'blockquote':
      return (
        <MessageQuote isCollapsible={node.attribs['data-collapsed'] === 'true'}>
          {renderChildren(node)}
        </MessageQuote>
      );
    case 'li': {
      const checked = node.attribs['data-checked'] ?? node.attribs['aria-checked'];
      if (checked === undefined) {
        return;
      }
      return (
        <li className={styles.checkItem}>
          <span
            className={styles.checkMark}
            role="checkbox"
            aria-checked={checked === 'true'}
            aria-readonly="true"
            aria-label={getElementText(node) || 'Empty task'}
          />
          <span>{renderChildren(node)}</span>
        </li>
      );
    }
    default:
      return;
  }
}

const parserOptions: HTMLReactParserOptions = { replace: renderRichElement };

/** Render safe semantic message content with interactive inline elements. */
export function RichMessageText({ richText }: { richText: string }) {
  const content = useMemo(() => parse(sanitizeRichText(richText), parserOptions), [richText]);
  return <div className={styles.content}>{content}</div>;
}
