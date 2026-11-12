import {
  Archive,
  ArrowLeft,
  Bell,
  BellOff,
  ContactRound,
  LoaderCircle,
  Phone,
  Search,
  Settings,
  Users,
  Video,
} from 'lucide-react';
import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Avatar } from '@/components/Avatar';
import type { components } from '@/api/schema';
import {
  communityAudienceLabel,
  conversationDestination,
  type CommunityKind,
} from '@/features/communities/communityModels';
import { CommunityDiscovery } from '@/features/communities/CommunityDiscovery';
import { CommunityProfile } from '@/features/communities/CommunityProfile';
import { CurrentUserProvider } from '@/features/chat/CurrentUser';
import { ApiError, isCancelled, type SessionOwner } from '@/features/auth/SessionOwner';
import type { CallOwner } from '@/features/calls/CallOwner';
import { ConnectedMediaContext } from '@/features/media/ConnectedMediaContext';
import { RemoteAvatar } from '@/features/media/RemoteAvatar';
import { playNotificationSound } from '@/features/settings/notifications/notificationDelivery';
import type { MessageInteraction } from '@/domain/messages/interaction';
import type { PollMedia } from '@/domain/messages/media';
import type { Message } from '@/domain/messages/message';
import type { Conversation as PickerConversation } from '@/domain/conversations/conversation';
import type { MessageCommand, MessageMenuAction } from '../messages/commands';
import type { ChecklistMedia } from '@/domain/messages/media';
import { checklistInput } from '../data/checklistInput';
import { canonicalMessageContent } from '../data/messageContent';
import { connectionStatusLabel } from '../data/connectionStatus';
import { MessageReadTimeScope } from '../messages/menu/MessageReadTimeScope';
import { DraftRecovery } from './DraftRecovery';
import { PendingConversationActions } from './PendingConversationActions';
import { ConnectedChatMenu } from './ConnectedChatMenu';
import { ConnectedConversationRow } from './ConnectedConversationRow';
import { ConnectedPeerProfile } from './ConnectedPeerProfile';
import { MessageRetryContext } from '../messages/messageRetryContext';
import { ActionConfirmation, type Confirmation } from './ActionConfirmation';
import { ConversationControls } from './ConversationControls';
import { PinnedMessages } from './PinnedMessages';
import { PollVotersDialog } from './PollVotersDialog';
import { ComposerListDialog, type ListSubmitOptions } from '../composer/forms/ComposerListDialog';
import { pollInput } from '../data/pollInput';
import { ChatOwner } from '../data/ChatOwner';
import {
  compareCounter,
  conversationMuteChange,
  destinationKey,
  isConversationMuted,
  type CanonicalMessage,
  type MessageBodyInput,
  renderMessage,
  renderPending,
  type Conversation,
  type Destination,
} from '../data/messageModels';
import { MessageComposer, type ComposedMessage } from '../composer/MessageComposer';
import { MessageTimeline } from '../history/MessageTimeline';
import { ChatSearch } from '../search/ChatSearch';
import { GlobalMessageSearch } from '../search/GlobalMessageSearch';
import { ShareContactDialog } from '../composer/ShareContactDialog';
import { ContactLinkContext } from '../messages/content/contact/ContactActions';
import {
  ForwardMessageDialog,
  type ForwardRecipients,
} from '../messages/forwarding/ForwardMessageDialog';
import { ReportMessageDialog } from './ReportMessageDialog';
import type { ActivityOwner } from '../activity/ActivityOwner';
import type { MessageSelectionChange } from '../messages/selection/useMessageSelectionGesture';
import styles from './ConnectedChat.module.css';

// prettier-ignore
const CONNECTED_ACTIONS: MessageMenuAction[] = [
  'reply',
  'edit',
  'delete',
  'pin',
  'copy',
  'add-task',
  'edit-checklist',
  'forward',
  'report',
  'select',
  'forward-selected',
  'delete-selected',
  'clear-selection',
];
const MAX_BATCH_MESSAGES = 20;
const EMPTY_ACTIVITY = { isOnline: false, isTyping: false, view: undefined };
const emptyActivity = () => EMPTY_ACTIVITY;
const subscribeToNothing = () => () => undefined;
const isCallIdle = () => false;
const REMOVE_MESSAGE_DESCRIPTION =
  'Choose whose history should change. Deletion cannot be undone. Existing forwarded copies remain available.';
// prettier-ignore
const REACTIONS = [
  '👍',
  '👎',
  '❤️',
  '🔥',
  '🥰',
  '👏',
  '😁',
  '🤔',
  '😢',
  '🎉',
];

interface ConnectedChatProps {
  owner: ChatOwner;
  session?: SessionOwner;
  activity?: ActivityOwner;
  calls?: CallOwner;
  areCallsAvailable?: boolean;
  isMediaAvailable?: boolean;
  isAvatarAvailable?: boolean;
  user: components['schemas']['PrivateProfile'];
  onSettings: () => void;
  onContacts: () => void;
  accountPage?: ReactNode;
  conversationRequest: number;
  onCommunities: () => void;
  onCreateCommunity: (kind: CommunityKind) => void;
  onOpenCommunity: (conversation: Conversation) => void;
}

function title(conversation: Conversation): string {
  if (conversation.kind === 'saved') {
    return 'Saved Messages';
  }
  return conversation.title || conversation.peer_name;
}

function ChatIdentityAvatar({
  name,
  conversation,
  session,
}: {
  name: string;
  conversation?: Conversation;
  session?: SessionOwner;
}) {
  const initials = conversation?.kind === 'saved' ? 'saved' : name.slice(0, 2).toUpperCase();
  const fileId = conversation?.avatar_file_id ?? conversation?.peer_avatar_file_id;
  if (!session || !conversation || !fileId || conversation.kind === 'saved') {
    return <Avatar initials={initials} size="small" />;
  }

  return (
    <RemoteAvatar
      session={session}
      owner={conversation.avatar_file_id ? 'conversation' : 'user'}
      id={conversation.avatar_file_id ? conversation.id : conversation.peer_id}
      fileId={fileId}
      initials={initials}
      size="small"
    />
  );
}

function forwardDestinationTitle(destination: Destination, conversations: Conversation[]): string {
  if (destination.kind === 'saved') {
    return 'Saved Messages';
  }

  const conversation = conversations.find((entry) => {
    return destination.kind === 'conversation'
      ? entry.id === destination.conversation_id
      : entry.kind === 'direct' && entry.peer_id === destination.user_id;
  });
  return conversation ? title(conversation) : 'Unavailable conversation';
}

function pickerConversation(conversation: Conversation): PickerConversation {
  const name = title(conversation);
  const kind = conversation.kind === 'direct' ? 'private' : conversation.kind;
  return {
    id: conversation.id,
    title: name,
    subtitle: conversation.peer_username,
    initials: name.slice(0, 2).toUpperCase(),
    color: '#5288c1',
    preview: conversation.summary_text,
    time: '',
    kind:
      kind === 'private' || kind === 'group' || kind === 'channel' || kind === 'saved'
        ? kind
        : undefined,
  };
}

function canEditPoll(message: CanonicalMessage | undefined): boolean {
  return message?.body?.kind === 'poll' && !message.is_deleted && message.body.can_edit;
}

/** Reuse the editor and bounded virtual timeline with authenticated, server-owned message state. */
export function ConnectedChat({
  owner,
  session,
  activity,
  calls,
  areCallsAvailable = false,
  isMediaAvailable = false,
  isAvatarAvailable,
  user,
  accountPage,
  conversationRequest,
  onSettings,
  onContacts,
  onCommunities,
  onCreateCommunity,
  onOpenCommunity,
}: ConnectedChatProps) {
  const snapshot = useSyncExternalStore(owner.subscribe, owner.getSnapshot);
  const connectionLabel = connectionStatusLabel(snapshot.connectionStatus);
  const presence = useSyncExternalStore(
    activity?.subscribe ?? subscribeToNothing,
    activity?.getSnapshot ?? emptyActivity,
  );
  const isCallBusy = useSyncExternalStore(
    calls?.subscribe ?? subscribeToNothing,
    calls?.isCallBusy ?? isCallIdle,
  );
  const [isDirectoryVisible, setIsDirectoryVisible] = useState(!snapshot.selection);
  const [isPersisting, setIsPersisting] = useState(false);
  const [error, setError] = useState('');
  const [profilePeerId, setProfilePeerId] = useState<string>();
  const [profileCommunityId, setProfileCommunityId] = useState<string>();
  const [latestSendRequest, setLatestSendRequest] = useState(0);
  const [folder, setFolder] = useState<'inbox' | 'archived' | 'hidden'>('inbox');
  const [directoryQuery, setDirectoryQuery] = useState('');
  const [searchConversationId, setSearchConversationId] = useState<string>();
  const [editing, setEditing] = useState<CanonicalMessage>();
  const [editVersion, setEditVersion] = useState('');
  const [confirmation, setConfirmation] = useState<Confirmation>();
  const [isPinsOpen, setIsPinsOpen] = useState(false);
  const [contactDestination, setContactDestination] = useState<string>();
  const [selectedIds, setSelectedIds] = useState<string[]>();
  const [forwardIds, setForwardIds] = useState<string[]>();
  const [reportedMessageId, setReportedMessageId] = useState<string>();
  const [voterMessageId, setVoterMessageId] = useState<string>();
  const [checklistEditor, setChecklistEditor] = useState<{
    messageId: string;
    version: string;
    initialChecklist: ChecklistMedia;
  }>();
  const [pollEditor, setPollEditor] = useState<{
    messageId: string;
    version: string;
    initialPoll: PollMedia;
  }>();
  const voterMessage = snapshot.messages.find((entry) => entry.id === voterMessageId);
  const voterPoll = voterMessage?.is_deleted ? undefined : voterMessage?.body;
  const canViewVoters =
    voterPoll?.kind === 'poll' && !voterPoll.is_anonymous && voterPoll.voter_count != null;
  const currentEditorMessage = snapshot.messages.find(
    (entry) => entry.id === pollEditor?.messageId,
  );
  const canShowPollEditor = canEditPoll(currentEditorMessage);
  const currentChecklist = snapshot.messages.find(
    (entry) => entry.id === checklistEditor?.messageId,
  );
  const canShowChecklistEditor =
    currentChecklist?.body?.kind === 'checklist' &&
    !currentChecklist.is_deleted &&
    currentChecklist.body.can_edit;
  // Keep the editor's captured object stable while canonical updates arrive underneath it.
  const editingMessage = useMemo(() => (editing ? renderMessage(editing) : undefined), [editing]);
  const conversation = owner.selectedConversation();
  const hasCallActions = conversation?.kind === 'direct' && areCallsAvailable;
  const selection = snapshot.selection;
  const chatCommands = snapshot.pendingCommands.filter((entry) => {
    return entry.request.conversation_id === conversation?.id;
  });
  const directoryCommands = snapshot.pendingCommands.filter((entry) => {
    return isDirectoryVisible || entry.request.conversation_id !== conversation?.id;
  });
  const peerIdForProfile =
    conversation?.kind === 'direct'
      ? conversation.peer_id
      : selection?.destination.kind === 'recipient'
        ? selection.destination.user_id
        : undefined;
  const conversationName = conversation
    ? title(conversation)
    : (selection?.title ?? 'Your messages');
  const activeAlertId = !isDirectoryVisible ? conversation?.id : undefined;
  useEffect(() => owner.setAlertConversation(activeAlertId), [owner, activeAlertId]);
  const isViewingDirect = conversation?.kind === 'direct' && !isDirectoryVisible;
  const directId = isViewingDirect ? conversation.id : undefined;
  const peerId = isViewingDirect ? conversation.peer_id : undefined;
  const generation = isViewingDirect ? conversation.generation : undefined;
  useEffect(() => {
    if (!activity || !directId || !peerId || !generation) {
      return;
    }

    return activity.setView({
      conversationId: directId,
      peerId,
      generation,
    });
  }, [activity, directId, peerId, generation]);
  const isCurrentActivity =
    presence.view?.conversationId === directId && presence.view?.generation === generation;
  const isCommunity = conversation?.kind === 'group' || conversation?.kind === 'channel';
  let conversationStatus = isCommunity
    ? communityAudienceLabel({
        kind: conversation.kind === 'channel' ? 'channel' : 'group',
        memberCount: conversation.member_count,
      })
    : 'Private conversation';
  if (isCurrentActivity && presence.isTyping) {
    conversationStatus = 'Typing…';
  } else if (isCurrentActivity && presence.isOnline) {
    conversationStatus = 'Online';
  }
  const canPost = conversation?.can_post ?? selection?.destination.kind !== 'conversation';
  const canForward = Boolean(conversation && conversation.is_forwarding_enabled !== false);
  const allowedActions = CONNECTED_ACTIONS.filter((action) => {
    if (action === 'report') {
      return Boolean(session);
    }
    if (action === 'pin') {
      return conversation?.can_manage ?? false;
    }
    if (action === 'reply' || action === 'edit') {
      return canPost;
    }
    if (action === 'forward' || action === 'forward-selected') {
      return canForward;
    }
    return true;
  });
  const messages = snapshot.messages.map((canonical) => {
    const message = renderMessage(canonical);
    message.isRead =
      conversation?.kind === 'direct' &&
      canonical.author_id === user.id &&
      compareCounter(canonical.sequence, conversation.peer_read_through) <= 0;
    return message;
  });
  const normalizedDirectoryQuery = directoryQuery.trim().toLowerCase();
  const isDiscovering = Boolean(normalizedDirectoryQuery && session && snapshot.isReady);
  const isChannelMuted = isConversationMuted(conversation);
  const shouldShowChannelMute = conversation?.kind === 'channel' && !canPost;
  const directory = snapshot.conversations.filter((entry) => {
    if (normalizedDirectoryQuery) {
      const isCommunityMatch = entry.kind === 'group' || entry.kind === 'channel';
      if (isDiscovering && isCommunityMatch) {
        return false;
      }
      const matchesTitle = title(entry).toLowerCase().includes(normalizedDirectoryQuery);
      return matchesTitle || entry.peer_username.toLowerCase().includes(normalizedDirectoryQuery);
    }
    if (folder === 'hidden') {
      return entry.is_hidden;
    }
    return !entry.is_hidden && entry.is_archived === (folder === 'archived');
  });
  directory.sort((first, second) => {
    const pinDifference = (first.pin_rank ?? Infinity) - (second.pin_rank ?? Infinity);
    return pinDifference || Date.parse(second.updated_at) - Date.parse(first.updated_at);
  });
  const reply = snapshot.draft.reply;
  let replyMessage: Message | undefined = messages.find(
    (message) => message.id === reply?.message_id,
  );
  if (reply && !replyMessage) {
    replyMessage = {
      id: reply.message_id,
      chatId: conversation?.id ?? '',
      authorId: '',
      authorName: 'Reply to message',
      text: snapshot.draft.isReplyUnavailable
        ? 'Message unavailable'
        : (reply.quote ?? 'Open the original message'),
      createdAt: 0,
      reactions: [],
    };
  }
  const acceptedIds = new Set(messages.map((message) => message.id));
  const selectedKey = selection ? destinationKey(selection.destination) : '';
  useEffect(() => {
    setIsDirectoryVisible(!selectedKey);
  }, [selectedKey, conversationRequest]);
  useEffect(() => {
    setEditing(undefined);
    setIsPinsOpen(false);
    setSearchConversationId(undefined);
    setConfirmation(undefined);
    setContactDestination(undefined);
    setProfilePeerId(undefined);
    setProfileCommunityId(undefined);
    setVoterMessageId(undefined);
    setPollEditor(undefined);
    setChecklistEditor(undefined);
    setSelectedIds(undefined);
    setForwardIds(undefined);
    setReportedMessageId(undefined);
  }, [selectedKey, conversation?.generation]);
  useEffect(() => {
    if (!canPost) {
      setEditing(undefined);
      setConfirmation(undefined);
    }
  }, [canPost]);
  const pending = snapshot.pending.filter((entry) => {
    const destination = entry.request.destination;
    const isCanonical =
      destination.kind === 'conversation' && destination.conversation_id === conversation?.id;
    const isRecipient =
      destination.kind === 'recipient' && destination.user_id === conversation?.peer_id;
    return destinationKey(destination) === selectedKey || isCanonical || isRecipient;
  });
  const inlinePending = snapshot.hasNewer ? [] : pending;
  const inlinePendingIds = new Set(inlinePending.map((entry) => entry.request.message_id));
  const outbox = snapshot.pending.filter(
    (entry) => isDirectoryVisible || !inlinePendingIds.has(entry.request.message_id),
  );
  for (const entry of inlinePending) {
    if (!acceptedIds.has(entry.request.message_id)) {
      messages.push(
        renderPending({
          pending: entry,
          user,
          conversationId: conversation?.id ?? selectedKey,
        }),
      );
    }
  }

  function report(failure: unknown) {
    if (!isCancelled(failure)) {
      setError(failure instanceof Error ? failure.message : 'The request could not be completed.');
    }
  }

  function retryCommand(operationId: string) {
    void owner.retryCommand(operationId).catch(report);
  }

  function dismissCommand(operationId: string) {
    void owner.discardCommand(operationId).catch(report);
  }

  function conversationNameForId(id: string) {
    const entry = snapshot.conversations.find((candidate) => candidate.id === id);
    return entry ? title(entry) : 'Unavailable conversation';
  }

  function openConversation(entry: Conversation) {
    setEditing(undefined);
    setIsPinsOpen(false);
    setError('');
    setDirectoryQuery('');
    const destination = conversationDestination(entry);
    void owner.select({ destination, title: title(entry) }).catch(report);
    setIsDirectoryVisible(false);
  }

  function openConversationProfile() {
    if (isCommunity) {
      setProfileCommunityId(conversation.id);
      return;
    }
    setProfilePeerId(peerIdForProfile);
  }

  function openDiscoveryResult(entry: Conversation) {
    setDirectoryQuery('');
    onOpenCommunity(entry);
  }

  function toggleChannelMute() {
    if (conversation) {
      const change = conversationMuteChange(conversation);
      void owner.command({ kind: 'preferences', change }).catch(report);
    }
  }

  function openFolder(nextFolder: typeof folder) {
    setDirectoryQuery('');
    setFolder(nextFolder);
  }

  function openSavedMessages() {
    const saved = snapshot.conversations.find((entry) => entry.kind === 'saved');
    if (saved) {
      openConversation(saved);
    }
  }

  async function jumpToLatest() {
    try {
      await owner.jumpToLatest();
    } catch (failure) {
      report(failure);
      throw failure;
    }
  }

  function retryPendingMessage(messageId: string) {
    void owner.retry(messageId).catch(report);
  }

  async function openGlobalResult(result: { conversationId: string; messageId: string }) {
    const conversations = owner.getSnapshot().conversations;
    const entry = conversations.find((candidate) => candidate.id === result.conversationId);
    if (!entry) {
      throw new ApiError({ code: 'not_found', message: 'Message unavailable' });
    }
    const destination = conversationDestination(entry);
    await owner.select({ destination, title: title(entry) }, { messageId: result.messageId });
    setDirectoryQuery('');
    setIsDirectoryVisible(false);
  }

  async function submit(message: ComposedMessage): Promise<boolean> {
    if (isPersisting) {
      return false;
    }
    activity?.recordComposerChange({ isTyping: false });
    setIsPersisting(true);
    setError('');
    try {
      if (editing) {
        await owner.command({
          kind: 'edit',
          message_id: editing.id,
          expected_version: editVersion,
          disable_link_preview: message.disableLinkPreview,
          content: canonicalMessageContent(message, {
            isCaption: Boolean(editing.attachments?.length),
          }),
        });
        setEditing(undefined);
      } else if (message.sticker) {
        await owner.queueBody({ kind: 'sticker', sticker_id: message.sticker });
      } else if (message.files?.length) {
        await owner.enqueueMedia({
          value: message,
          files: message.files,
          shouldSendFilesSeparately: message.shouldSendFilesSeparately,
          shouldPreserveDraft: message.shouldPreserveDraft,
          disableLinkPreview: message.disableLinkPreview,
        });
      } else {
        await owner.queueSend(message);
      }
      if (!editing && snapshot.hasNewer) {
        setLatestSendRequest((current) => current + 1);
      }
      const defaults = session?.getSnapshot().preferences?.notification_defaults;
      if (!editing && defaults?.should_play_sent_sound) {
        void playNotificationSound({ volume: defaults.volume, isSent: true });
      }
      return true;
    } catch (failure) {
      report(failure);
      return false;
    } finally {
      setIsPersisting(false);
    }
  }

  async function queueContact(body: MessageBodyInput): Promise<boolean> {
    try {
      await owner.queueBody(body);
      return true;
    } catch (failure) {
      report(failure);
      return false;
    }
  }

  async function queuePoll(message: ComposedMessage): Promise<boolean> {
    if (message.media?.kind !== 'poll') {
      return false;
    }

    await owner.queueBody({ ...pollInput(message.media), kind: 'poll' });
    return true;
  }

  async function savePoll(message: ComposedMessage, options?: ListSubmitOptions): Promise<boolean> {
    if (!pollEditor || message.media?.kind !== 'poll') {
      return false;
    }

    await owner.command({
      kind: 'edit_poll',
      message_id: pollEditor.messageId,
      expected_poll_version: pollEditor.version,
      poll: pollInput(message.media),
      preserve_quiz: options?.shouldPreserveQuiz,
    });
    return true;
  }

  async function queueChecklist(message: ComposedMessage): Promise<boolean> {
    if (message.media?.kind !== 'checklist') {
      return false;
    }

    await owner.queueBody({ ...checklistInput(message.media), kind: 'checklist' });
    return true;
  }

  async function saveChecklist(message: ComposedMessage): Promise<boolean> {
    if (!checklistEditor || message.media?.kind !== 'checklist') {
      return false;
    }

    await owner.command({
      kind: 'edit_checklist',
      message_id: checklistEditor.messageId,
      expected_list_version: checklistEditor.version,
      checklist: checklistInput(message.media),
    });
    return true;
  }

  async function interactWithChecklist(
    message: CanonicalMessage,
    body: components['schemas']['ChecklistView'],
    interaction: MessageInteraction,
  ): Promise<boolean> {
    switch (interaction.type) {
      case 'set-task':
        await owner.command({
          kind: 'set_checklist_task',
          message_id: message.id,
          task_id: interaction.taskId,
          expected_task_version: interaction.expectedTaskVersion,
          is_complete: interaction.isComplete,
        });
        return true;
      case 'append-tasks':
        if (interaction.expectedListVersion === undefined) {
          return false;
        }
        await owner.command({
          kind: 'append_checklist_tasks',
          message_id: message.id,
          expected_list_version: interaction.expectedListVersion,
          tasks: interaction.tasks,
        });
        return true;
      case 'edit-checklist': {
        const checklist = renderMessage(message).media;
        if (checklist?.kind !== 'checklist' || !body.can_edit) {
          return false;
        }
        setChecklistEditor({
          messageId: message.id,
          version: body.list_version,
          initialChecklist: checklist,
        });
        return true;
      }
      default:
        return false;
    }
  }

  async function interact(messageId: string, interaction: MessageInteraction): Promise<boolean> {
    const message = snapshot.messages.find((entry) => entry.id === messageId);
    const body = message?.body;
    if (!message || message.is_deleted || !body) {
      return false;
    }

    try {
      if (body.kind === 'checklist') {
        setError('');
        return await interactWithChecklist(message, body, interaction);
      }
      if (body.kind !== 'poll') {
        return false;
      }

      switch (interaction.type) {
        case 'vote':
          await owner.command({
            kind: 'vote_poll',
            message_id: messageId,
            option_ids: interaction.optionIds,
          });
          break;
        case 'add-option':
          await owner.command({
            kind: 'add_poll_option',
            message_id: messageId,
            expected_poll_version: body.version,
            option: { id: interaction.id, text: interaction.text },
          });
          break;
        case 'edit-poll': {
          const poll = renderMessage(message).media;
          if (poll?.kind === 'poll' && body.can_edit) {
            // prettier-ignore
            setPollEditor({
              messageId,
              version: body.version,
              initialPoll: poll,
            });
          }
          break;
        }
        case 'close-poll':
          setConfirmation({
            title: 'Close poll?',
            description: 'Voting will end immediately.',
            choices: [
              {
                label: 'Close poll',
                action: () => owner.command({ kind: 'close_poll', message_id: messageId }),
              },
            ],
          });
          break;
        case 'view-voters':
          setVoterMessageId(messageId);
          break;
      }
      return true;
    } catch (failure) {
      report(failure);
      return false;
    }
  }

  async function openContactLink(accountId: string) {
    if (await owner.openContact(accountId)) {
      setIsDirectoryVisible(false);
    }
  }

  function messageCommand(command: MessageCommand) {
    const canonical = snapshot.messages.find((message) => message.id === command.message.id);
    if (!canonical || canonical.is_deleted || canonical.service_kind) {
      return;
    }
    switch (command.action) {
      case 'report':
        setReportedMessageId(canonical.id);
        break;
      case 'select':
        toggleSelection(canonical.id);
        break;
      case 'clear-selection':
        setSelectedIds(undefined);
        break;
      case 'forward':
        setForwardIds([canonical.id]);
        break;
      case 'forward-selected':
        setForwardIds(selectedIds);
        break;
      case 'delete-selected':
        confirmSelectedRemoval();
        break;
      case 'reply':
        setEditing(undefined);
        void owner.setReply({ message_id: canonical.id }).catch(report);
        break;
      case 'edit':
        setEditing(canonical);
        setEditVersion(canonical.version);
        break;
      case 'copy':
        void navigator.clipboard.writeText(command.message.text).catch(report);
        break;
      case 'pin':
        void owner
          .command({
            kind: 'pin',
            message_id: canonical.id,
            is_pinned: !canonical.is_pinned,
          })
          .catch(report);
        break;
      case 'delete': {
        const choices: Confirmation['choices'] = [
          {
            label: 'Hide for me',
            action: () => owner.command({ kind: 'hide_message', message_id: canonical.id }),
          },
        ];
        if (canonical.author_id === user.id || (isCommunity && conversation.can_manage)) {
          choices.push({
            label: 'Delete for everyone',
            action: () => owner.command({ kind: 'delete', message_id: canonical.id }),
          });
        }
        setConfirmation({
          title: 'Remove message?',
          description: REMOVE_MESSAGE_DESCRIPTION,
          choices,
        });
        break;
      }
    }
  }

  function toggleSelection(messageId: string) {
    const current = selectedIds ?? [];
    setMessageSelection({ messageIds: [messageId], shouldSelect: !current.includes(messageId) });
  }

  function setMessageSelection({ messageIds, shouldSelect }: MessageSelectionChange) {
    if (!shouldSelect) {
      setSelectedIds((current) => current?.filter((id) => !messageIds.includes(id)));
      return;
    }

    const eligibleMessages = snapshot.messages.filter(
      (message) => !message.is_deleted && !message.service_kind && messageIds.includes(message.id),
    );
    if (eligibleMessages.length === 0) {
      return;
    }

    const eligibleIds = eligibleMessages.map((message) => message.id);
    const selected = new Set([...(selectedIds ?? []), ...eligibleIds]);
    if (selected.size > MAX_BATCH_MESSAGES) {
      setError(`You can select up to ${MAX_BATCH_MESSAGES} messages.`);
    }
    setSelectedIds((current) => {
      const ids = new Set([...(current ?? []), ...eligibleIds]);
      return Array.from(ids).slice(0, MAX_BATCH_MESSAGES);
    });
  }

  function confirmSelectedRemoval() {
    if (!selectedIds?.length) {
      return;
    }
    const ids = selectedIds;
    const selected = snapshot.messages.filter((message) => ids.includes(message.id));
    const mayDelete =
      selected.length === ids.length &&
      selected.every((message) => {
        return message.author_id === user.id || (isCommunity && conversation.can_manage);
      });
    const choices: Confirmation['choices'] = [
      { label: 'Hide for me', action: async () => removeSelected({ ids, kind: 'batch_hide' }) },
    ];
    if (mayDelete) {
      choices.push({
        label: 'Delete for everyone',
        action: async () => removeSelected({ ids, kind: 'batch_delete' }),
      });
    }
    setConfirmation({
      title: 'Remove selected messages?',
      description: REMOVE_MESSAGE_DESCRIPTION,
      choices,
    });
  }

  async function removeSelected(input: { ids: string[]; kind: 'batch_hide' | 'batch_delete' }) {
    await owner.command({ kind: input.kind, message_ids: input.ids });
    setSelectedIds(undefined);
  }

  async function forwardTo({ recipients, caption, customEmoji, richText }: ForwardRecipients) {
    if (!forwardIds?.length) {
      return false;
    }
    // A changed conversation must not submit picks from the previous history.
    const current = owner.getSnapshot().selection;
    if (!current || destinationKey(current.destination) !== selectedKey) {
      return false;
    }
    const ids = new Set(forwardIds);
    const ordered = snapshot.messages.filter((message) => ids.has(message.id));
    if (ordered.length !== ids.size) {
      throw new Error('Some selected messages are no longer available.');
    }
    const destinations = recipients.map((recipient) => ({
      kind: 'conversation' as const,
      conversation_id: recipient.id,
    }));
    await owner.queueForwards({
      destinations,
      messageIds: ordered.map((message) => message.id),
      comment: { text: caption, customEmoji, richText },
    });
    setSelectedIds(undefined);
    return true;
  }

  function react(messageId: string, emoji: string) {
    const message = snapshot.messages.find((entry) => entry.id === messageId);
    if (!message) {
      return;
    }
    const isSelected = message.reactions.some(
      (reaction) => reaction.emoji === emoji && reaction.is_selected,
    );
    void owner
      .command({
        kind: 'reaction',
        message_id: messageId,
        emoji,
        is_selected: !isSelected,
      })
      .catch(report);
  }

  async function confirm(action: () => Promise<void>) {
    setIsPersisting(true);
    try {
      await action();
      setConfirmation(undefined);
    } catch (failure) {
      report(failure);
    } finally {
      setIsPersisting(false);
    }
  }

  const mediaActions = session
    ? {
        session,
        retry: (id: string) => void owner.retry(id).catch(report),
        cancel: (id: string) => void owner.discard(id).catch(report),
        jump: (id: string) => void owner.jumpToMessage(id).catch(report),
        reselect: (input: { messageId: string; occurrenceId: string; file: File }) =>
          void owner.restoreMediaSource(input).catch(report),
        notify: setError,
      }
    : undefined;

  return (
    <CurrentUserProvider value={user.id}>
      <main
        className={styles.workspace}
        data-directory-visible={isDirectoryVisible || Boolean(accountPage)}
      >
        <aside
          className={styles.directory}
          aria-label="Conversations"
          hidden={Boolean(accountPage)}
        >
          <header className={styles.directoryHeader}>
            {folder === 'inbox' ? (
              <ConnectedChatMenu
                onOpenSaved={openSavedMessages}
                onOpenArchived={() => openFolder('archived')}
                onOpenHidden={() => openFolder('hidden')}
                onCreate={onCreateCommunity}
              />
            ) : (
              <button type="button" aria-label="Back to inbox" onClick={() => openFolder('inbox')}>
                <ArrowLeft />
              </button>
            )}
            <h1>
              {folder === 'archived' && 'Archived Chats'}
              {folder === 'hidden' && 'Hidden Chats'}
              {folder === 'inbox' && 'Messages'}
            </h1>
            <button type="button" aria-label="Account settings" onClick={onSettings}>
              <Settings />
            </button>
            <button type="button" aria-label="Contacts" onClick={onContacts}>
              <ContactRound />
            </button>
            <button type="button" aria-label="Communities" onClick={onCommunities}>
              <Users />
            </button>
          </header>
          {!snapshot.isReady && <p role="status">Loading conversations…</p>}
          <div className={styles.directorySearch}>
            {connectionLabel ? (
              <LoaderCircle size={18} className={styles.connectionSpinner} aria-hidden="true" />
            ) : (
              <Search size={18} aria-hidden="true" />
            )}
            <input
              type="text"
              aria-label="Search chats and messages"
              placeholder={connectionLabel ?? 'Search'}
              value={directoryQuery}
              onChange={(event) => setDirectoryQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape' && !event.nativeEvent.isComposing) {
                  setDirectoryQuery('');
                }
              }}
            />
          </div>
          {connectionLabel && (
            <p
              className={styles.directoryConnection}
              data-has-query={Boolean(directoryQuery)}
              role="status"
            >
              {connectionLabel}
            </p>
          )}
          {!normalizedDirectoryQuery &&
            folder === 'inbox' &&
            snapshot.conversations.some((entry) => entry.is_archived && !entry.is_hidden) && (
              <button
                type="button"
                className={styles.archiveEntry}
                onClick={() => openFolder('archived')}
              >
                <Archive aria-hidden="true" /> Archived Chats
              </button>
            )}
          {directory.map((entry) => (
            <ConnectedConversationRow
              key={entry.id}
              conversation={entry}
              name={title(entry)}
              session={session}
              isSelected={conversation?.id === entry.id}
              onOpen={() => openConversation(entry)}
              onCommand={(action) => {
                void owner
                  .commandForConversation({ conversationId: entry.id, action })
                  .catch(report);
              }}
            />
          ))}
          {isDiscovering && session && (
            <CommunityDiscovery
              session={session}
              chat={owner}
              query={directoryQuery}
              onAdmitted={openDiscoveryResult}
            />
          )}
          {snapshot.isReady && (
            <GlobalMessageSearch
              query={directoryQuery}
              visibilityKey={owner.searchVisibilityKey()}
              loadPage={owner.searchMessages}
              onSelect={openGlobalResult}
            />
          )}
          <PendingConversationActions
            commands={directoryCommands}
            conversationName={conversationNameForId}
            onRetry={retryCommand}
            onDismiss={dismissCommand}
          />
          {outbox.length > 0 && (
            <section className={styles.pending} aria-label="Pending messages">
              <h2>Pending messages</h2>
              {outbox.map((entry) => (
                <div className={styles.pendingItem} key={entry.request.message_id}>
                  <button
                    type="button"
                    onClick={() => {
                      void owner
                        .select({
                          destination: entry.request.destination,
                          title: entry.title ?? 'Pending conversation',
                        })
                        .catch(report);
                      setIsDirectoryVisible(false);
                    }}
                  >
                    {entry.request.content.text ||
                      entry.media?.map((item) => item.filename).join(', ') ||
                      'Pending message'}
                  </button>
                  <p>{entry.error || 'Waiting for server confirmation'}</p>
                  <div className={styles.actions}>
                    <button
                      type="button"
                      onClick={() => void owner.retry(entry.request.message_id).catch(report)}
                    >
                      Retry
                    </button>
                    <button
                      type="button"
                      onClick={() => void owner.discard(entry.request.message_id).catch(report)}
                    >
                      Remove from outbox
                    </button>
                  </div>
                </div>
              ))}
              <p>
                Removing an unconfirmed item does not delete a message already saved by the server.
              </p>
            </section>
          )}
          {snapshot.pendingForwards.length > 0 && (
            <section className={styles.pending} aria-label="Pending forwards">
              <h2>Pending forwards</h2>
              {snapshot.pendingForwards.map((entry) => (
                <div className={styles.pendingItem} key={entry.request.operation_id}>
                  <strong>
                    {forwardDestinationTitle(entry.request.destination, snapshot.conversations)}
                  </strong>
                  <p>{entry.error ?? 'Waiting for server confirmation'}</p>
                  {entry.error && (
                    <button
                      type="button"
                      onClick={() =>
                        void owner.dismissForward(entry.request.operation_id).catch(report)
                      }
                    >
                      Dismiss forward
                    </button>
                  )}
                </div>
              ))}
            </section>
          )}
        </aside>
        {accountPage && (
          <aside className={styles.accountSidebar} aria-label="Account pages">
            {accountPage}
          </aside>
        )}
        <section className={styles.chat} aria-label="Chat">
          <header className={styles.chatHeader}>
            <button
              type="button"
              aria-label="Back to conversations"
              onClick={() => {
                owner.cancelContactOpen();
                setIsDirectoryVisible(true);
              }}
            >
              <ArrowLeft />
            </button>
            <div className={styles.chatIdentity}>
              {selection && (
                <ChatIdentityAvatar
                  name={conversationName}
                  conversation={conversation}
                  session={session}
                />
              )}
              <div className={styles.chatIdentityText}>
                <h2>{conversationName}</h2>
                <p aria-live="polite">{conversationStatus}</p>
              </div>
              {session && (peerIdForProfile || isCommunity) && (
                <button
                  type="button"
                  className={styles.peerProfile}
                  aria-label={`View ${conversationName} profile`}
                  aria-haspopup="dialog"
                  onClick={openConversationProfile}
                />
              )}
            </div>
            {hasCallActions && (
              <>
                <button
                  type="button"
                  aria-label="Start voice call"
                  disabled={!calls || !canPost || isCallBusy}
                  onClick={() =>
                    void calls?.start({ conversationId: conversation.id, mode: 'voice' })
                  }
                >
                  <Phone />
                </button>
                <button
                  type="button"
                  aria-label="Start video call"
                  disabled={!calls || !canPost || isCallBusy}
                  onClick={() =>
                    void calls?.start({ conversationId: conversation.id, mode: 'video' })
                  }
                >
                  <Video />
                </button>
              </>
            )}
            {conversation && (
              <button
                type="button"
                aria-label="Search this conversation"
                aria-pressed={searchConversationId === conversation.id}
                onClick={() => {
                  setIsPinsOpen(false);
                  setSearchConversationId((current) => {
                    return current === conversation.id ? undefined : conversation.id;
                  });
                }}
              >
                <Search />
              </button>
            )}
            {conversation && (
              <ConversationControls
                conversation={conversation}
                onCommand={(action) => owner.command(action)}
                onConfirm={setConfirmation}
                onError={report}
                onPins={() => setIsPinsOpen(true)}
              />
            )}
          </header>
          {connectionLabel && (
            <p className={styles.mobileConnection} role="status">
              <LoaderCircle size={16} className={styles.connectionSpinner} aria-hidden="true" />
              {connectionLabel}
            </p>
          )}
          {hasCallActions && !calls && (
            <p role="status" className={styles.callUnavailable}>
              Calls are unavailable in this browser.
            </p>
          )}
          {conversation && searchConversationId === conversation.id && (
            <div className={styles.conversationSearch}>
              <ChatSearch
                key={conversation.id}
                messages={messages}
                canFilterSender={conversation.kind !== 'saved'}
                onClose={() => setSearchConversationId(undefined)}
                onJump={(messageId) => owner.jumpToMessage(messageId, { shouldRevalidate: true })}
                source={{
                  conversationId: conversation.id,
                  visibilityKey: owner.searchVisibilityKey(conversation.id),
                  loadPage: owner.searchMessages,
                  onJumpToDate: (timestamp) => owner.jumpToDate(timestamp),
                  senderRoster:
                    conversation.kind === 'group'
                      ? { revision: conversation.generation, loadPage: owner.loadSearchSenders }
                      : undefined,
                  senders:
                    conversation.kind === 'direct'
                      ? [
                          { id: user.id, name: user.display_name },
                          { id: conversation.peer_id, name: conversation.peer_name },
                        ]
                      : undefined,
                }}
              />
            </div>
          )}
          {conversation && searchConversationId !== conversation.id && (
            <PinnedMessages
              key={`${conversation.id}:${conversation.generation}`}
              owner={owner}
              version={conversation.version}
              isListOpen={isPinsOpen}
              onOpen={() => setIsPinsOpen(true)}
              onClose={() => setIsPinsOpen(false)}
              onError={report}
            />
          )}
          {(error || snapshot.error) && (
            <p className={styles.error} role="alert">
              {error || snapshot.error}
            </p>
          )}
          {selection ? (
            <>
              {selectedIds && (
                <div className={styles.historyControls} aria-label="Message selection">
                  <button type="button" onClick={() => setSelectedIds(undefined)}>
                    Cancel selection
                  </button>
                  <span>{selectedIds.length} selected</span>
                  {canForward && (
                    <button
                      type="button"
                      disabled={!selectedIds.length}
                      onClick={() => setForwardIds(selectedIds)}
                    >
                      Forward selected messages
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={!selectedIds.length}
                    onClick={confirmSelectedRemoval}
                  >
                    Delete selected messages
                  </button>
                </div>
              )}
              <div className={styles.historyPane}>
                {snapshot.isLoading && (
                  <div className={styles.historyLoading} role="status">
                    Loading messages…
                  </div>
                )}
                <ConnectedMediaContext.Provider value={mediaActions}>
                  <ContactLinkContext.Provider
                    value={session ? (id) => void openContactLink(id).catch(report) : undefined}
                  >
                    <MessageReadTimeScope
                      session={session}
                      isDirect={conversation?.kind === 'direct'}
                    >
                      <MessageRetryContext.Provider value={retryPendingMessage}>
                        <MessageTimeline
                          key={selectedKey}
                          messages={messages}
                          precedingMessage={
                            snapshot.precedingMessage
                              ? renderMessage(snapshot.precedingMessage)
                              : undefined
                          }
                          shouldShowSender={conversation?.kind === 'group'}
                          allowedActions={allowedActions}
                          selectedIds={selectedIds}
                          onToggleSelection={toggleSelection}
                          onSetSelection={setMessageSelection}
                          reactionChoices={REACTIONS}
                          navigation={snapshot.navigation}
                          firstUnreadMessageId={snapshot.firstUnreadMessageId}
                          unreadCount={Number(conversation?.unread_count ?? 0)}
                          isMuted={isConversationMuted(conversation)}
                          latestRequest={latestSendRequest}
                          onReachMessage={(messageId) => {
                            if (
                              !isDirectoryVisible &&
                              !editing &&
                              !profilePeerId &&
                              !profileCommunityId
                            ) {
                              void owner.markReached(messageId).catch(report);
                            }
                          }}
                          remoteHistory={{
                            hasOlder: snapshot.hasOlder,
                            hasNewer: snapshot.hasNewer,
                            isLoading: snapshot.isLoading,
                            loadOlder: () => void owner.loadHistory('older'),
                            loadNewer: () => void owner.loadHistory('newer'),
                            jumpToLatest,
                          }}
                          searchQuery=""
                          onCommand={messageCommand}
                          onReact={react}
                          onInteract={interact}
                          onOpenMedia={() => undefined}
                          onJumpToMessage={(id) => void owner.jumpToMessage(id).catch(report)}
                        />
                      </MessageRetryContext.Provider>
                    </MessageReadTimeScope>
                  </ContactLinkContext.Provider>
                </ConnectedMediaContext.Provider>
              </div>
              <footer className={styles.composer}>
                <DraftRecovery
                  key={selectedKey}
                  local={snapshot.draft}
                  conflict={snapshot.draftConflict}
                  alternatives={snapshot.draftAlternatives}
                  onKeep={() => void owner.keepLocalDraft().catch(report)}
                  onRestore={(draft) => void owner.restoreDraft(draft).catch(report)}
                />
                <PendingConversationActions
                  commands={chatCommands}
                  messages={snapshot.messages}
                  onRetry={retryCommand}
                  onDismiss={dismissCommand}
                />
                {canPost &&
                  editing &&
                  snapshot.editConflict?.id === editing.id &&
                  snapshot.editConflict.version !== editVersion && (
                    <details className={styles.recovery}>
                      <summary className={styles.recoveryToggle}>Review conflicting edit</summary>
                      <div className={styles.recoveryPanel}>
                        <p>Current message: {snapshot.editConflict.content.text}</p>
                        <p>
                          Your edit is still in the editor. Choose whether to save it over this
                          version.
                        </p>
                        <button
                          type="button"
                          onClick={() => setEditVersion(snapshot.editConflict!.version)}
                        >
                          Keep my edit for next save
                        </button>
                        <button type="button" onClick={() => setEditing(undefined)}>
                          Discard my edit
                        </button>
                      </div>
                    </details>
                  )}
                {shouldShowChannelMute && (
                  <button type="button" className={styles.channelMute} onClick={toggleChannelMute}>
                    {isChannelMuted ? <Bell aria-hidden="true" /> : <BellOff aria-hidden="true" />}
                    {isChannelMuted ? 'Unmute channel' : 'Mute channel for one day'}
                  </button>
                )}
                {!canPost && !shouldShowChannelMute && (
                  <p role="status">You cannot post in this conversation.</p>
                )}
                {canPost && (
                  <MessageComposer
                    key={selectedKey}
                    isTextOnly
                    canSendSticker
                    onShareContact={session ? () => setContactDestination(selectedKey) : undefined}
                    isPollAnonymousOnly={conversation?.kind === 'channel'}
                    onPollSubmit={queuePoll}
                    onChecklistSubmit={queueChecklist}
                    isMediaAvailable={isMediaAvailable}
                    onMediaSubmit={submit}
                    onLoadLinkPreview={session?.previewLink}
                    editingMessage={editingMessage}
                    replyMessage={replyMessage}
                    isDisabled={isPersisting || !snapshot.isReady || !canPost}
                    draft={snapshot.draft.value.text}
                    draftIdentity={snapshot.draft.id}
                    draftCustomEmoji={snapshot.draft.value.customEmoji}
                    draftRichText={snapshot.draft.value.richText}
                    onDraftChange={(value) => {
                      activity?.recordComposerChange({ isTyping: value.text.trim().length > 0 });
                      void owner.setDraft(value).catch(report);
                    }}
                    onSubmit={(message) => void submit(message)}
                    onCancelContext={() => {
                      setEditing(undefined);
                      void owner.setReply(undefined).catch(report);
                    }}
                    onJumpToMessage={(id) => void owner.jumpToMessage(id).catch(report)}
                    onNotify={setError}
                  />
                )}
              </footer>
            </>
          ) : (
            <div className={styles.empty}>Choose a conversation or find someone to message.</div>
          )}
        </section>
        {session && isCommunity && profileCommunityId === conversation.id && (
          <CommunityProfile
            key={`${conversation.id}:${conversation.generation}`}
            session={session}
            chat={owner}
            id={conversation.id}
            isAvatarAvailable={isAvatarAvailable}
            onClose={() => setProfileCommunityId(undefined)}
          />
        )}
        {session && profilePeerId && profilePeerId === peerIdForProfile && (
          <ConnectedPeerProfile
            key={profilePeerId}
            session={session}
            peerId={profilePeerId}
            title={conversationName}
            onClose={() => setProfilePeerId(undefined)}
          />
        )}
        {session && contactDestination === selectedKey && (
          <ShareContactDialog
            key={contactDestination}
            session={session}
            onClose={() => setContactDestination(undefined)}
            onSubmit={queueContact}
          />
        )}
        {reportedMessageId && session && (
          <ReportMessageDialog
            key={reportedMessageId}
            session={session}
            messageIds={[reportedMessageId]}
            onClose={() => setReportedMessageId(undefined)}
          />
        )}
        {forwardIds && (
          <ForwardMessageDialog
            conversations={snapshot.conversations
              .filter((entry) => entry.can_post)
              .map(pickerConversation)}
            onClose={() => setForwardIds(undefined)}
            onChooseRecipient={(recipient) => {
              void forwardTo({ recipients: [recipient], caption: '' }).catch(report);
            }}
            onSend={forwardTo}
          />
        )}
        {pollEditor && canShowPollEditor && canPost && (
          <ComposerListDialog
            key={pollEditor.messageId}
            kind="poll"
            isConnected
            isPollAnonymousOnly={conversation?.kind === 'channel'}
            initialPoll={pollEditor.initialPoll}
            onClose={() => setPollEditor(undefined)}
            onSubmit={savePoll}
          />
        )}
        {checklistEditor && canShowChecklistEditor && (
          <ComposerListDialog
            key={checklistEditor.messageId}
            kind="checklist"
            isConnected
            initialChecklist={checklistEditor.initialChecklist}
            onClose={() => setChecklistEditor(undefined)}
            onSubmit={saveChecklist}
          />
        )}
        {voterMessageId && canViewVoters && (
          <PollVotersDialog
            key={`${conversation?.generation}:${voterMessageId}`}
            owner={owner}
            session={session}
            messageId={voterMessageId}
            poll={voterPoll}
            onClose={() => setVoterMessageId(undefined)}
          />
        )}
        <ActionConfirmation
          confirmation={confirmation}
          isBusy={isPersisting}
          onCancel={() => setConfirmation(undefined)}
          onChoose={(action) => void confirm(action)}
        />
      </main>
    </CurrentUserProvider>
  );
}
