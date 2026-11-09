import type { components } from '@/api/schema';
import { ApiError, requirePayload, type SessionOwner } from '@/features/auth/SessionOwner';
import {
  PendingMessages,
  type PendingCommunityOperation,
} from '@/features/chat/data/pendingMessages';

const RETRY_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
// prettier-ignore
const TRANSIENT_CODES = new Set([
  'dependency_unavailable',
  'rate_limited',
  'network_unavailable',
]);

type Receipt = components['schemas']['CommandReceipt'];
type CreateSettings = Omit<
  components['schemas']['CreateCommunity'],
  'operation_id' | 'conversation_id'
>;

interface CommunityOperationOptions {
  session: SessionOwner;
  store: PendingMessages;
  currentEpoch: () => string | undefined;
  applyReceipt: (input: {
    conversationId: string;
    receipt: Receipt;
    epoch?: string;
  }) => Promise<void>;
}

/** Persist uncertain membership changes and reuse their identity through explicit recovery. */
export class CommunityOperations {
  private readonly options: CommunityOperationOptions;
  private operations: PendingCommunityOperation[] = [];
  private readonly listeners = new Set<() => void>();

  /** Reuse the chat session's existing durable ownership and revocation tombstone. */
  constructor(options: CommunityOperationOptions) {
    this.options = options;
  }

  /** Return the currently recovered operations for the community recovery panel. */
  getSnapshot = (): PendingCommunityOperation[] => this.operations;

  /** Observe local operation recovery without coupling it to conversation rendering. */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Recover unresolved operations from the active session store. */
  async refresh(): Promise<void> {
    const persisted = await this.options.store.read();
    this.operations = persisted.communities ?? [];
    for (const listener of this.listeners) {
      listener();
    }
  }

  /** Create a community only after its operation and conversation identities are durable. */
  async create(settings: CreateSettings): Promise<Receipt> {
    const remembered = await this.options.store.rememberCommunity({
      kind: 'create',
      createdAt: Date.now(),
      request: {
        ...settings,
        operation_id: crypto.randomUUID(),
        conversation_id: crypto.randomUUID(),
      },
    });
    return this.retry(remembered.request.operation_id);
  }

  /** Submit a desired membership or management action using one stable operation identity. */
  async command(input: {
    conversationId: string;
    action: components['schemas']['CommunityAction'];
  }): Promise<Receipt> {
    const remembered = await this.options.store.rememberCommunity({
      kind: 'command',
      createdAt: Date.now(),
      request: {
        operation_id: crypto.randomUUID(),
        conversation_id: input.conversationId,
        action: input.action,
      },
    });
    return this.retry(remembered.request.operation_id);
  }

  /** Retry the original request without silently reapplying an operation past receipt retention. */
  async retry(operationId: string): Promise<Receipt> {
    await this.refresh();
    const operation = this.operations.find((entry) => entry.request.operation_id === operationId);
    if (!operation) {
      throw new Error('This community operation has already been resolved.');
    }
    if (Date.now() - operation.createdAt >= RETRY_LIFETIME_MS) {
      throw new Error('Review current membership before removing this expired operation.');
    }
    const epoch = this.options.currentEpoch();
    let receipt: Receipt;
    try {
      const reply =
        operation.kind === 'create'
          ? await this.options.session.client.POST('/api/v1/communities', {
              body: operation.request,
            })
          : await this.options.session.client.POST('/api/v1/communities/commands', {
              body: operation.request,
            });
      receipt = requirePayload(reply);
    } catch (error) {
      if (error instanceof ApiError && !TRANSIENT_CODES.has(error.code)) {
        await this.dismiss(operationId);
      }
      throw error;
    }
    // Commit access removal before forgetting an acknowledged operation, just like message commands.
    await this.options.applyReceipt({
      conversationId: operation.request.conversation_id,
      receipt,
      epoch,
    });
    await this.dismiss(operationId);
    return receipt;
  }

  /** Dismiss an operation after reconciliation without claiming to cancel a committed action. */
  async dismiss(operationId: string): Promise<void> {
    await this.options.store.removeCommunity(operationId);
    await this.refresh();
  }
}
