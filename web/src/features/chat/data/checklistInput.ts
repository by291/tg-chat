import type { components } from '@/api/schema';
import type { ChecklistMedia } from '@/domain/messages/media';

/** Encode the checklist definition for creation and structural edits. */
export function checklistInput(checklist: ChecklistMedia): components['schemas']['ChecklistInput'] {
  return {
    title: checklist.title,
    tasks: checklist.items.map(({ id, text }) => ({ id, text })),
    can_others_complete: checklist.canOthersComplete,
    can_others_append: checklist.canOthersAppend,
  };
}
