import { Menu } from '@ark-ui/react/menu';
import { Portal } from '@ark-ui/react/portal';
import { ChevronRight, Ellipsis, Pin, Timer } from 'lucide-react';
import type { components } from '@/api/schema';
import { IconButton } from '@/components/IconButton';
import overlays from '@/components/overlays/overlays.module.css';
import type { Conversation } from '../data/messageModels';
import type { Confirmation } from './ActionConfirmation';
import { ConversationActions } from './ConversationActions';

const AUTO_DELETE_PERIODS = [
  { days: 0, label: 'Off' },
  { days: 1, label: 'After 1 day' },
  { days: 7, label: 'After 7 days' },
  { days: 30, label: 'After 30 days' },
];

interface ConversationControlsProps {
  conversation: Conversation;
  onCommand: (action: components['schemas']['CommandAction']) => Promise<void>;
  onConfirm: (confirmation: Confirmation) => void;
  onError: (error: unknown) => void;
  onPins: () => void;
}

function forwardingAction(conversation: Conversation): string {
  if (conversation.is_forwarding_enabled) {
    return 'Disable forwarding';
  }
  if (conversation.has_forwarding_consent) {
    return 'Withdraw forwarding approval';
  }
  if (conversation.kind === 'direct') {
    return 'Approve forwarding';
  }
  return 'Enable forwarding';
}

/** Present personal preferences and authorized chat controls in the header menu. */
export function ConversationControls(props: ConversationControlsProps) {
  const conversation = props.conversation;

  function change(action: components['schemas']['CommandAction']) {
    void props.onCommand(action).catch(props.onError);
  }

  function confirm(kind: 'clear' | 'close') {
    const isClosing = kind === 'close';
    props.onConfirm({
      title: isClosing ? 'Close conversation?' : 'Clear history for me?',
      description:
        'This removes your access to existing history. Other participants keep their copies.',
      choices: [
        {
          label: isClosing ? 'Close conversation' : 'Clear for me',
          action: () => props.onCommand({ kind }),
        },
      ],
    });
  }

  return (
    <Menu.Root positioning={{ placement: 'bottom-end', gutter: 8 }}>
      <Menu.Trigger asChild>
        <IconButton label="Conversation options">
          <Ellipsis />
        </IconButton>
      </Menu.Trigger>
      <Portal>
        <Menu.Positioner>
          <Menu.Content className={overlays.menu}>
            <Menu.Item value="pins" className={overlays.menuItem} onSelect={props.onPins}>
              <Pin /> Pinned messages
            </Menu.Item>
            <ConversationActions conversation={conversation} onCommand={change} />
            {conversation.can_manage && (
              <Menu.Root positioning={{ placement: 'left-start', gutter: 6 }}>
                <Menu.TriggerItem className={overlays.menuItem}>
                  <Timer /> Auto-delete messages <ChevronRight />
                </Menu.TriggerItem>
                <Portal>
                  <Menu.Positioner>
                    <Menu.Content className={overlays.menu}>
                      <Menu.RadioItemGroup
                        value={String(conversation.expiry_days)}
                        onValueChange={({ value }) =>
                          change({ kind: 'expiry', days: Number(value) })
                        }
                      >
                        {AUTO_DELETE_PERIODS.map(({ days, label }) => (
                          <Menu.RadioItem
                            key={days}
                            value={String(days)}
                            className={overlays.menuItem}
                          >
                            <Menu.ItemIndicator>✓</Menu.ItemIndicator>
                            {label}
                          </Menu.RadioItem>
                        ))}
                      </Menu.RadioItemGroup>
                    </Menu.Content>
                  </Menu.Positioner>
                </Portal>
              </Menu.Root>
            )}
            <Menu.CheckboxItem
              value="keep-archived"
              className={overlays.menuItem}
              checked={conversation.keep_archived}
              onCheckedChange={(keepArchived) =>
                change({
                  kind: 'preferences',
                  change: { field: 'archive_retention', keep_archived: keepArchived },
                })
              }
            >
              <Menu.ItemIndicator>✓</Menu.ItemIndicator> Keep archived when messages arrive
            </Menu.CheckboxItem>
            <Menu.Item
              value="hidden"
              className={overlays.menuItem}
              onSelect={() =>
                change({
                  kind: 'preferences',
                  change: { field: 'hidden', is_hidden: !conversation.is_hidden },
                })
              }
            >
              {conversation.is_hidden ? 'Show conversation' : 'Hide conversation'}
            </Menu.Item>
            {conversation.can_set_forwarding_policy && (
              <Menu.Item
                value="forwarding"
                className={overlays.menuItem}
                onSelect={() =>
                  change({
                    kind: 'set_forwarding_policy',
                    is_enabled:
                      !conversation.is_forwarding_enabled && !conversation.has_forwarding_consent,
                  })
                }
              >
                {forwardingAction(conversation)}
              </Menu.Item>
            )}
            <Menu.Separator className={overlays.menuSeparator} />
            <Menu.Item
              value="clear"
              className={overlays.menuItem}
              onSelect={() => confirm('clear')}
            >
              Clear history
            </Menu.Item>
            {conversation.kind === 'direct' && (
              <Menu.Item
                value="close"
                className={overlays.menuItem}
                onSelect={() => confirm('close')}
              >
                Close conversation
              </Menu.Item>
            )}
          </Menu.Content>
        </Menu.Positioner>
      </Portal>
    </Menu.Root>
  );
}
