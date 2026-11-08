import type { TextFormatType } from 'lexical';
import {
  Bold,
  Code,
  Highlighter,
  Italic,
  Strikethrough,
  Subscript,
  Superscript,
  Underline,
  type LucideIcon,
} from 'lucide-react';

export const TEXT_FORMATS: FormatAction[] = [
  {
    label: 'Bold',
    format: 'bold',
    icon: Bold,
  },
  {
    label: 'Italic',
    format: 'italic',
    icon: Italic,
  },
  {
    label: 'Underline',
    format: 'underline',
    icon: Underline,
  },
  {
    label: 'Strikethrough',
    format: 'strikethrough',
    icon: Strikethrough,
  },
];
export const EXTENDED_FORMATS: FormatAction[] = [
  {
    label: 'Monospace',
    format: 'code',
    icon: Code,
  },
  {
    label: 'Highlight',
    format: 'highlight',
    icon: Highlighter,
  },
  {
    label: 'Subscript',
    format: 'subscript',
    icon: Subscript,
  },
  {
    label: 'Superscript',
    format: 'superscript',
    icon: Superscript,
  },
];

export interface FormatAction {
  label: string;
  format: TextFormatType;
  icon: LucideIcon;
}
