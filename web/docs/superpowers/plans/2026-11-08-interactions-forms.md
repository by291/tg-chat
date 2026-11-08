# Interactions and Forms Implementation

## Authorized scope

Replace sortable input, media gesture recognition, and structured-message form state with
libraries in the current checkout. Preserve storage keys, serialized messages, and backend scope.
The user canceled all lazy loading introduced during this change. Existing lazy loading remains
unchanged. Settings, details, media viewing, and composition retain their original static imports.

## Ownership

- dnd-kit owns pointer and keyboard sorting sessions. Poll fields use sortable siblings.
  Pinned chats use explicit draggable/droppable identities and cloned feedback because virtual
  rows must retain ownership of their DOM children. Ordering commits only on a valid drop.
- use-gesture owns drag/pinch recognition. Application code retains anchored zoom, rotated bounds,
  wheel policies, momentum, and navigation thresholds. A post-pinch handoff preserves panning
  when either finger lifts; starting another pinch ends that continuation.
- React Hook Form and useFieldArray own poll/checklist fields. Zod validates dependent answers,
  whitespace-equivalent duplicates, limits, and required fields. Validated submissions retain
  existing message shapes and the duplicate-submission guard.

## Regression coverage

- Selecting conversations preserves the mounted viewport and immediately exposes selection UI.
- Reordering a visible pinned chat retains offscreen pinned identities and virtual row ownership.
- Escape cancels poll sorting without closing the dialog or changing the option order.
- Pinch release works in either finger order and can return to pinch without double panning.
- Window blur cancels navigation gestures.
- Whitespace-equivalent poll answers cannot be submitted.

## Review and verification

Independent review identified virtual-row reparenting, mixed sortable indices, and pinch handoff
problems. These have behavioral regression coverage. The canceled lazy-loading implementation
and its pending-media close problem were removed together.

- Full suite: 95 files and 479 tests passed.
- TypeScript and Vite production build passed. Vite retains its large-chunk warning; no new lazy
  loading or bundle-size optimization is included.
- Prettier and whitespace checks passed.
- Browser checks passed for immediate photo opening, zoom, immediate conversation selection,
  keyboard and pointer pinned sorting, virtual row ownership, and post-drop focus restoration.
- Poll pointer/keyboard sorting, Escape cancellation, duplicate answers, and quiz validation were
  checked in the browser. Test pin changes were restored and no test messages were submitted.
- Browser touch-device automation was not performed; pointer handoff and repeated pinch behavior
  are covered by the viewer regression suite.
