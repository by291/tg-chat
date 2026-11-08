export type MessageInteraction =
  | { type: 'vote'; optionIds: string[] }
  | { type: 'add-option'; id: string; text: string }
  | { type: 'toggle-task'; taskId: string }
  | { type: 'add-task'; id: string; text: string };
