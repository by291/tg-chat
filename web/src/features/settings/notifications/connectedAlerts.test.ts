import { expect, it } from 'vitest';
import { ConnectedAlerts, type AlertGroup } from './connectedAlerts';

const CONVERSATION = {
  id: 'conversation',
  kind: 'direct',
  read_through: '5',
  clear_through: '0',
  muted_until: null,
  generation: '1',
};

function group(position: string, messageId: string): AlertGroup {
  return {
    position,
    is_new_message: true,
    conversation_id: CONVERSATION.id,
    conversation: CONVERSATION,
    message: {
      id: messageId,
      author_id: 'peer',
      sequence: position,
      is_deleted: false,
    },
  };
}

it('alerts on live messages once and consumes reconnect backfill without replay', () => {
  const alerts = new ConnectedAlerts();
  const context = {
    userId: 'current-user',
    isForeground: true,
    conversations: [CONVERSATION],
    canNotify: () => true,
  };
  const cached = group('6', 'cached');
  expect(alerts.completeSync({ groups: [cached], context })).toEqual([]);

  const live = group('7', 'live');
  expect(alerts.completeSync({ groups: [live], context })).toEqual([
    { messageId: 'live', conversationId: 'conversation' },
  ]);
  expect(alerts.completeSync({ groups: [live], context })).toEqual([]);

  alerts.resetBaseline();
  const missed = group('8', 'missed');
  expect(alerts.completeSync({ groups: [missed], context })).toEqual([]);
  expect(alerts.completeSync({ groups: [missed], context })).toEqual([]);
  expect(alerts.completeSync({ groups: [group('9', 'after-reconnect')], context })).toEqual([
    { messageId: 'after-reconnect', conversationId: 'conversation' },
  ]);
});

it('does not alert while reading the conversation or from a removed projection', () => {
  const alerts = new ConnectedAlerts();
  const context = {
    userId: 'current-user',
    isForeground: true,
    conversations: [CONVERSATION],
    activeConversationId: 'conversation',
    canNotify: () => true,
  };
  alerts.completeSync({ groups: [], context });
  const active = group('6', 'active');
  expect(alerts.completeSync({ groups: [active], context })).toEqual([]);

  const removed = group('7', 'removed');
  const inaccessible = { ...context, activeConversationId: undefined, conversations: [] };
  expect(alerts.completeSync({ groups: [removed], context: inaccessible })).toEqual([]);
  const away = { ...context, activeConversationId: undefined };
  const edit = { ...group('8', 'edited'), is_new_message: false };
  expect(alerts.completeSync({ groups: [edit], context: away })).toEqual([]);
  expect(alerts.completeSync({ groups: [active, removed], context: away })).toEqual([]);
});
