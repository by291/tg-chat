import katex from 'katex';

const MAX_FORMULA_EXPANSIONS = 500;
const MAX_FORMULA_SIZE = 20;

/** Render formula source with the same bounded, untrusted policy in editors and messages. */
export function renderFormulaHtml(options: { source: string; isBlock: boolean }) {
  return katex.renderToString(options.source, {
    displayMode: options.isBlock,
    throwOnError: false,
    trust: false,
    strict: 'ignore',
    maxExpand: MAX_FORMULA_EXPANSIONS,
    maxSize: MAX_FORMULA_SIZE,
    output: 'htmlAndMathml',
  });
}
