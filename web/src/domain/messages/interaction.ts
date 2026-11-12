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
  | { type: 'edit-checklist' }
  | {
      type: 'set-task';
      taskId: string;
      expectedTaskVersion: string;
      isComplete: boolean;
    }
  | {
      type: 'append-tasks';
      tasks: { id: string; text: string }[];
      expectedListVersion?: string;
    };
