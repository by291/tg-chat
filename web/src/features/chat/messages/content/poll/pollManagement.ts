import type { PollMedia } from '@/domain/messages/media';
import { getSelectedPollOptions } from '../../../state/pollVoting';

/** Resolve menu and activation permissions from the current poll and its deadline. */
export function pollManagement(poll: PollMedia, now = Date.now()) {
  const hasExpired = poll.closesAt !== undefined && poll.closesAt <= now;
  const isOpen = !poll.isSnapshot && !poll.isClosed && !hasExpired;
  const hasVote = getSelectedPollOptions(poll).length > 0;
  return {
    canChangeVote: isOpen && hasVote && poll.canVote !== false && poll.canRevote !== false,
    canEdit: isOpen && Boolean(poll.canEdit),
    canClose: isOpen && Boolean(poll.canClose),
  };
}
