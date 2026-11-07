import components from 'prismjs/components.json';

interface LanguageDefinition {
  title: string;
  alias?: string | string[];
  require?: string | string[];
}

const { meta: grammarMetadata, ...definitions } = components.languages;
const languageDefinitions: Record<string, LanguageDefinition> = definitions;

/** Resolve a saved language alias to its canonical Prism grammar. */
export function resolveCodeLanguage(language?: string): string | undefined {
  if (!language) {
    return undefined;
  }
  const normalized = language.toLowerCase();
  for (const [name, definition] of Object.entries(languageDefinitions)) {
    if (name === 'meta') {
      continue;
    }
    const aliases = definition.alias;
    const hasAlias = Array.isArray(aliases) ? aliases.includes(normalized) : aliases === normalized;
    if (name === normalized || hasAlias) {
      return name;
    }
  }
  return undefined;
}

/** Return the language title shown in the code header, when it is recognized. */
export function getCodeLanguageLabel(language?: string): string | undefined {
  const name = resolveCodeLanguage(language);
  return name ? languageDefinitions[name].title : undefined;
}

/** Return prerequisites that must be registered before a language grammar is imported. */
export function getCodeLanguageDependencies(language: string): string[] {
  const required = languageDefinitions[language]?.require;
  if (!required) {
    return [];
  }
  return typeof required === 'string' ? [required] : required;
}
