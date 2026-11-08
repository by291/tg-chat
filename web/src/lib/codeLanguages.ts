import components from 'prismjs/components.json';

// Adapted from tweb codeLanguageDetectorShared.ts (GPL-3.0).
const LANGUAGE_HINTS: Array<[language: string, pattern: RegExp]> = [
  ['php', /<\?php\b/],
  [
    'rust',
    /(?:^|\n)\s*(?:fn\s+main\s*\(|use\s+(?:crate|std)::|let\s+mut\b)|\b(?:println|eprintln)!\s*\(/,
  ],
  [
    'go',
    /(?:^|\n)\s*package\s+main\b|(?:^|\n)\s*func\s+\w+\s*\(|\bfmt\.(?:Print|Printf|Println)\s*\(/,
  ],
  ['cpp', /#include\s*<[^>]+>|\bstd::|\b(?:cout|cin)\s*(?:<<|>>)/],
  ['csharp', /(?:^|\n)\s*using\s+System\s*;|\bConsole\.(?:Write|WriteLine)\s*\(/],
  ['java', /\bpublic\s+static\s+void\s+main\s*\(|\bSystem\.out\.print(?:ln)?\s*\(/],
  [
    'typescript',
    new RegExp(
      String.raw`(?:^|\n)\s*(?:interface\s+\w+|type\s+\w+\s*=|enum\s+\w+)|\b(?:const|let|` +
        String.raw`var)\s+\w+\s*:\s*[A-Za-z_$]`,
    ),
  ],
  [
    'javascript',
    /\b(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*=|=>|\bconsole\.(?:log|warn|error)\s*\(/,
  ],
  [
    'python',
    new RegExp(
      String.raw`(?:^|\n)\s*(?:def|from|import)\s+[A-Za-z_]|(?:^|` +
        String.raw`\n)\s*class\s+\w+\s*(?:\([^)]*\))?\s*:|\bprint\s*\([^;{}]*\)\s*$`,
      'm',
    ),
  ],
  [
    'sql',
    new RegExp(
      String.raw`(?:^|\n)\s*(?:SELECT|WITH|INSERT\s+INTO|UPDATE|DELETE\s+FROM|` +
        String.raw`CREATE\s+(?:TABLE|INDEX)|ALTER\s+TABLE)\b`,
      'i',
    ),
  ],
  [
    'bash',
    /^#!\s*\/[^\n]*\b(?:ba|z|k)?sh\b|(?:^|\n)\s*(?:export\s+\w+=|echo\s+\$|(?:ba|z|k)?sh\s+)/,
  ],
  ['xml', /<\/?(?:html|body|head|div|span|script|style|svg|[A-Za-z][\w:-]*\s+[\w:-]+=)[^>]*>/i],
];

const { meta: grammarMetadata, ...definitions } = components.languages;
const languageDefinitions: Record<string, LanguageDefinition> = definitions;

interface LanguageDefinition {
  title: string;
  alias?: string | string[];
  require?: string | string[];
}

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

/** Identify unambiguous language syntax before statistical detection. */
export function getCodeLanguageHint(code: string) {
  for (const [language, pattern] of LANGUAGE_HINTS) {
    if (pattern.test(code)) {
      return language;
    }
  }
}
