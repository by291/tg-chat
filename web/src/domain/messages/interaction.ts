export type MessageInteraction =
  | { type: 'vote'; optionIds: string[] }
  | { type: 'edit-poll' }
  | { type: 'close-poll' }
  | { type: 'view-voters' }
  | {
      type: 'add-option';
      id: string;
      text: string;
    }
  | { type: 'toggle-task'; taskId: string }
  | {
      type: 'add-task';
      id: string;
      text: string;
    };
