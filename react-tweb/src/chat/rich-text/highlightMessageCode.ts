import Prism from 'prismjs';
import { detectCodeLanguage } from './detectCodeLanguage';
import { getCodeLanguageDependencies, resolveCodeLanguage } from './codeLanguageLabels';

const grammarModules = import.meta.glob([
  '/node_modules/prismjs/components/prism-*.js',
  '!/node_modules/prismjs/components/prism-*.min.js',
]);
const pendingGrammars = new Map<string, Promise<void>>();

interface HighlightOptions {
  source: string;
  language?: string;
}

async function importGrammar(language: string): Promise<void> {
  for (const dependency of getCodeLanguageDependencies(language)) {
    await loadGrammar(dependency);
  }
  const importModule = grammarModules[`/node_modules/prismjs/components/prism-${language}.js`];
  if (importModule) {
    await importModule();
  }
}

function loadGrammar(language: string): Promise<void> {
  if (Prism.languages[language]) {
    return Promise.resolve();
  }
  const pending = pendingGrammars.get(language);
  if (pending) {
    return pending;
  }
  // Grammar modules mutate Prism's registry, so concurrent bubbles share dependency loading.
  const loading = importGrammar(language);
  pendingGrammars.set(language, loading);
  void loading.catch(() => pendingGrammars.delete(language));
  return loading;
}

/** Highlight source text with the same detector and Prism grammars used by tweb. */
export async function highlightMessageCode({ source, language }: HighlightOptions) {
  const detected = language || detectCodeLanguage(source);
  const canonical = resolveCodeLanguage(detected);
  if (!canonical) {
    return undefined;
  }
  await loadGrammar(canonical);
  const grammar = Prism.languages[canonical];
  if (!grammar) {
    return undefined;
  }
  return {
    html: Prism.highlight(source, grammar, canonical),
    language: canonical,
  };
}
