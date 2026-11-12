import type { components } from '@/api/schema';
import type { ChecklistMedia, PollMedia } from '@/domain/messages/media';
import type { Message, PendingMediaDisplay } from '@/domain/messages/message';
import type { PendingMessage } from './pendingMessages';

export type CanonicalMessage = components['schemas']['CanonicalMessage'];
export type Conversation = components['schemas']['ConversationView'];
export type Destination = components['schemas']['Destination'];
export type MessageBodyInput = components['schemas']['MessageBodyInput'];

const MUTE_DAY_MS = 24 * 60 * 60 * 1000;
const PERCENTAGE_SCALE = 100;

export const MAX_VISIBLE_MESSAGES = 200;

/** Check the current deadline for the conversation's notification mute. */
export function isConversationMuted(conversation?: Conversation): boolean {
  const deadline = conversation?.muted_until;
  return Boolean(deadline && Date.parse(deadline) > Date.now());
}

/** Toggle the default mute from both the conversation menu and the channel footer. */
export function conversationMuteChange(
  conversation: Conversation,
): components['schemas']['PreferenceChange'] {
  const isMuted = isConversationMuted(conversation);
  const until = isMuted ? null : new Date(Date.now() + MUTE_DAY_MS).toISOString();
  return { field: 'mute', until };
}

/** Compare authoritative decimal counters without browser integer precision loss. */
export function compareCounter(first: string, second: string): number {
  const difference = BigInt(first) - BigInt(second);
  if (difference === 0n) {
    return 0;
  }
  return difference > 0n ? 1 : -1;
}

/** Merge delayed projections monotonically while retaining a bounded sequence window. */
export function mergeMessages(options: {
  current: CanonicalMessage[];
  incoming: CanonicalMessage[];
  edge: 'older' | 'newer' | 'latest';
}): CanonicalMessage[] {
  const messages = new Map(options.current.map((message) => [message.id, message]));
  for (const message of options.incoming) {
    const existing = messages.get(message.id);
    if (!existing) {
      messages.set(message.id, message);
      continue;
    }
    const content = compareCounter(message.version, existing.version) >= 0 ? message : existing;
    const interactionOrder = compareCounter(
      message.interaction_version,
      existing.interaction_version,
    );
    const interactions = interactionOrder >= 0 ? message : existing;
    let body = content.body;
    if (body?.kind === 'poll' && interactions.body?.kind === 'poll') {
      body = interactions.body;
      // Reads observe deadline closure before maintenance publishes a new interaction version.
      const previousPoll = existing.body?.kind === 'poll' ? existing.body : undefined;
      if (interactionOrder === 0 && previousPoll?.is_closed && !body.is_closed) {
        body = previousPoll;
      }
    }
    if (body?.kind === 'checklist' && interactions.body?.kind === 'checklist') {
      body = interactions.body;
    }
    messages.set(message.id, {
      ...content,
      ...(body !== undefined && { body }),
      // A preview belongs to one content revision even when reactions arrive out of order.
      ...((content.link_preview !== undefined || interactions.link_preview !== undefined) && {
        link_preview:
          interactions.version === content.version && !content.is_deleted
            ? interactions.link_preview
            : content.link_preview,
      }),
      interaction_version: interactions.interaction_version,
      is_pinned: !content.is_deleted && interactions.is_pinned,
      reactions: content.is_deleted ? [] : interactions.reactions,
    });
  }
  const ordered = Array.from(messages.values());
  ordered.sort((first, second) => compareCounter(first.sequence, second.sequence));
  if (options.edge === 'older') {
    return ordered.slice(0, MAX_VISIBLE_MESSAGES);
  }
  return ordered.slice(-MAX_VISIBLE_MESSAGES);
}

/** Remove obsolete reply excerpts when a source edit reaches either cache or visible history. */
export function scrubReplySource(
  messages: CanonicalMessage[],
  source: CanonicalMessage,
): CanonicalMessage[] {
  const current = messages.find((message) => message.id === source.id);
  const authoritative =
    current && compareCounter(current.version, source.version) > 0 ? current : source;
  return messages.map((message) => {
    const reply = message.reply;
    if (
      reply?.message_id !== source.id ||
      !reply.quote ||
      authoritative.content.text.includes(reply.quote)
    ) {
      return message;
    }
    return { ...message, reply: { ...reply, quote: null } };
  });
}

/** Give draft and pending records stable destination ownership before a conversation exists. */
export function destinationKey(destination: Destination): string {
  switch (destination.kind) {
    case 'saved':
      return 'saved';
    case 'recipient':
      return `recipient:${destination.user_id}`;
    case 'conversation':
      return `conversation:${destination.conversation_id}`;
  }
}

function renderPoll(poll: components['schemas']['PollView']): PollMedia {
  const hasVisibleResults = poll.voter_count != null;
  return {
    kind: 'poll',
    question: poll.question,
    description: poll.description ?? undefined,
    options: poll.options.map((option) => ({
      id: option.id,
      text: option.text,
      votes: option.votes ?? 0,
    })),
    voterCount: poll.voter_count ?? undefined,
    selectedOptionIds: poll.selected_option_ids,
    shouldShowVoters: !poll.is_anonymous,
    canChooseMultiple: poll.is_multiple_choice,
    canAddOptions: poll.can_add_options,
    canRevote: poll.can_revote,
    canVote: poll.can_vote,
    correctOptionIds: poll.correct_option_ids ?? undefined,
    explanation: poll.explanation ?? undefined,
    closesAt: poll.closes_at ? Date.parse(poll.closes_at) : undefined,
    shouldHideResults: poll.hide_results_until_close,
    isClosed: poll.is_closed,
    isQuiz: poll.is_quiz,
    hasVisibleResults,
    canClose: poll.can_close,
    canEdit: poll.can_edit,
    canViewVoters: !poll.is_anonymous && hasVisibleResults,
  };
}

function renderPendingPoll(poll: components['schemas']['PollInput']): PollMedia {
  return {
    kind: 'poll',
    question: poll.question,
    description: poll.description ?? undefined,
    options: poll.options.map((option) => ({ ...option, votes: 0 })),
    shouldShowVoters: !poll.is_anonymous,
    canChooseMultiple: poll.is_multiple_choice,
    isQuiz: Boolean(poll.quiz),
    canVote: false,
    hasVisibleResults: false,
    closesAt: poll.closes_at ? Date.parse(poll.closes_at) : undefined,
  };
}

function renderChecklist(checklist: components['schemas']['ChecklistView']): ChecklistMedia {
  return {
    kind: 'checklist',
    title: checklist.title,
    listVersion: checklist.list_version,
    canOthersComplete: checklist.can_others_complete,
    canOthersAppend: checklist.can_others_append,
    canComplete: checklist.can_complete,
    canAppend: checklist.can_append,
    canEdit: checklist.can_edit,
    items: checklist.tasks.map((task) => ({
      id: task.id,
      text: task.text,
      version: task.version,
      isCompleted: task.is_complete,
      completedBy: task.completed_by
        ? { id: task.completed_by.user_id, name: task.completed_by.display_name }
        : undefined,
    })),
  };
}

function renderPendingChecklist(
  checklist: components['schemas']['ChecklistInput'],
): ChecklistMedia {
  return {
    kind: 'checklist',
    title: checklist.title,
    canOthersComplete: checklist.can_others_complete ?? false,
    canOthersAppend: checklist.can_others_append ?? false,
    canComplete: false,
    canAppend: false,
    canEdit: false,
    items: checklist.tasks.map((task) => ({ ...task, isCompleted: false })),
  };
}

/** Adapt accepted transport content to the existing renderer without demo state. */
export function renderMessage(message: CanonicalMessage): Message {
  const body = message.is_deleted ? undefined : message.body;
  let media: Message['media'];
  if (body?.kind === 'poll') {
    media = renderPoll(body);
  } else if (body?.kind === 'poll_snapshot') {
    media = {
      kind: 'poll',
      question: body.question,
      options: body.options.map((option) => ({ ...option, votes: 0 })),
      canVote: false,
      hasVisibleResults: false,
      isSnapshot: true,
    };
  } else if (body?.kind === 'checklist') {
    media = renderChecklist(body);
  } else if (body?.kind === 'checklist_snapshot') {
    media = {
      kind: 'checklist',
      title: body.title,
      canOthersComplete: false,
      canOthersAppend: false,
      canComplete: false,
      canAppend: false,
      items: body.tasks.map((task) => ({
        id: task.id,
        text: task.text,
        isCompleted: task.is_complete,
      })),
    };
  } else if (body?.kind === 'contact') {
    media = {
      kind: 'contact',
      name: body.display_name,
      userId: body.account_id ?? undefined,
      phone: body.phone ?? '',
      initials: '',
    };
  }

  return {
    id: message.id,
    chatId: message.conversation_id,
    authorId: message.author_id,
    authorName: message.author_name,
    text: message.content.text,
    forwardedFrom: message.forwarded_from ?? undefined,
    sticker: body?.kind === 'sticker' ? body.sticker_id : undefined,
    media,
    disableLinkPreview: message.disable_link_preview ?? undefined,
    linkPreview:
      !message.is_deleted && message.link_preview
        ? {
            kind: 'link',
            url: message.link_preview.url,
            site: message.link_preview.site_name,
            title: message.link_preview.title,
            description: message.link_preview.summary,
          }
        : undefined,
    richText: message.content.rich_text ?? undefined,
    customEmoji: message.content.custom_emoji.map((entity) => ({
      documentId: entity.document_id,
      offset: entity.offset,
      length: entity.length,
    })),
    createdAt: Date.parse(message.created_at),
    reactions: message.reactions.map((reaction) => reaction.emoji),
    reactionDetails: message.reactions.map((reaction) => ({
      emoji: reaction.emoji,
      count: reaction.count,
      isSelected: reaction.is_selected,
    })),
    replyToId: message.reply?.message_id,
    isReplyUnavailable: message.reply?.is_unavailable,
    replyQuote:
      message.reply?.quote && !message.reply.is_unavailable
        ? { text: message.reply.quote }
        : undefined,
    isPinned: message.is_pinned,
    isEdited: Boolean(message.edited_at),
    isService: Boolean(message.service_kind),
    expiresAt: message.expires_at ? Date.parse(message.expires_at) : undefined,
    deliveryStatus: 'accepted',
    remoteAttachments: message.attachments,
  };
}

function uploadPercentage(bytes: number, totalBytes: number): number {
  if (totalBytes <= 0) {
    return 0;
  }
  const percentage = Math.round((bytes / totalBytes) * PERCENTAGE_SCALE);
  return Math.max(0, Math.min(percentage, PERCENTAGE_SCALE));
}

function pendingUploadStatus(pending: PendingMessage, totalBytes: number): string {
  const progress = pending.mediaProgress;
  if (pending.status === 'failed') {
    return 'Upload failed';
  }
  if (pending.request.attachments?.length) {
    return 'Sending message';
  }
  if (progress?.phase === 'processing') {
    return 'Processing attachments';
  }
  if (progress && totalBytes > 0) {
    return `Uploading ${uploadPercentage(progress.bytes, totalBytes)}%`;
  }
  return 'Waiting to upload';
}

function pendingUploadDisplay(pending: PendingMessage): PendingMediaDisplay | undefined {
  if (!pending.media?.length) {
    return undefined;
  }

  const progress = pending.mediaProgress;
  const totalBytes = pending.media.reduce((bytes, item) => bytes + item.sizeBytes, 0);
  const activeItem = pending.media.find((item) => item.occurrenceId === progress?.occurrenceId);
  const firstUnfinished = pending.media.find((item) => !item.fileId);
  const controlItem = activeItem ?? firstUnfinished ?? pending.media[0];
  const items = pending.media.map((item) => {
    const hasLocalPreview = item.kind === 'image' || item.kind === 'video';
    const itemProgress = item.occurrenceId === progress?.occurrenceId ? progress : undefined;
    return {
      occurrenceId: item.occurrenceId,
      filename: item.filename,
      kind: item.kind,
      previewSource: hasLocalPreview ? item.blob : undefined,
      isReady: Boolean(item.fileId),
      progress: itemProgress && {
        phase: itemProgress.phase,
        percentage: uploadPercentage(itemProgress.occurrenceBytes, item.sizeBytes),
      },
    };
  });

  return {
    status: pendingUploadStatus(pending, totalBytes),
    canRestart: pending.canRestartMedia,
    error: pending.error,
    activeOccurrenceId: controlItem.occurrenceId,
    items,
  };
}

/** Render a durable local operation using the same row key it will have after acceptance. */
export function renderPending(options: {
  pending: PendingMessage;
  user: { id: string; display_name: string };
  conversationId: string;
}): Message {
  const { pending, user, conversationId } = options;
  const body = pending.request.body;
  const message = renderMessage({
    id: pending.request.message_id,
    conversation_id: conversationId,
    author_id: user.id,
    author_name: user.display_name,
    content: pending.request.content,
    body: body?.kind === 'poll' || body?.kind === 'checklist' ? undefined : body,
    created_at: new Date(pending.createdAt).toISOString(),
    sequence: '0',
    version: '0',
    interaction_version: '0',
    is_deleted: false,
    is_pinned: false,
    reactions: [],
  });

  let media = message.media;
  if (body?.kind === 'poll') {
    media = renderPendingPoll(body);
  }
  if (body?.kind === 'checklist') {
    media = renderPendingChecklist(body);
  }

  return {
    ...message,
    media,
    deliveryStatus: pending.status,
    deliveryError: pending.status === 'failed' ? pending.error : undefined,
    pendingMedia: pendingUploadDisplay(pending),
  };
}
