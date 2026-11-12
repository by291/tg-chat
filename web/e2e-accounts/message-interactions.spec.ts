import { randomUUID } from 'node:crypto';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import type { components } from '../src/api/schema';

const PASSWORD = 'a complete message workflow password phrase';
const CONVERGENCE_TIMEOUT_MS = 15_000;
const POLL_QUESTION = 'Choose an arrival time';
const CHECKLIST_TITLE = 'Prepare the meeting';

const FORWARDED_DOCUMENT = 'forwarded-meeting-notes.txt';
const FORWARDED_BYTES = 'The forwarded document remains available through its own attachment.';
const SEARCH_HIT = '週末遙遠會議紀錄';
const SEARCH_TERM = '遙遠會議';
const NEWER_HISTORY_MESSAGES = 64;
const NO_PREVIEW_URL = 'https://opt-out.example.test/meeting';

interface Account {
  context: BrowserContext;
  page: Page;
  grant: components['schemas']['AuthResponse'];
  origin: string;
}

function latch<Value>() {
  let release: (value: Value) => void = () => undefined;
  const ready = new Promise<Value>((resolve) => {
    release = resolve;
  });
  return { ready, release };
}

async function register(context: BrowserContext, origin: string): Promise<Account> {
  const username = `interaction_${randomUUID().slice(0, 8)}`;
  const response = await context.request.post('/api/v1/auth/register', {
    headers: { origin, 'x-tg-chat-request': '1' },
    data: {
      username,
      display_name: username,
      password: PASSWORD,
      device_name: 'Message interactions browser',
    },
  });
  expect(response.status()).toBe(201);

  return {
    context,
    page: await context.newPage(),
    grant: await response.json(),
    origin,
  };
}

function headers(account: Account) {
  return {
    origin: account.origin,
    'x-tg-chat-request': '1',
    'x-csrf-token': account.grant.csrf_token,
  };
}

async function createGroup(owner: Account): Promise<components['schemas']['ConversationView']> {
  const suffix = randomUUID().slice(0, 8);
  const input: components['schemas']['CreateCommunity'] = {
    operation_id: randomUUID(),
    conversation_id: randomUUID(),
    kind: 'group',
    title: `Planning group ${suffix}`,
    description: '',
    is_public: true,
    public_handle: `planning_${suffix}`,
    requires_approval: false,
  };
  const response = await owner.context.request.post('/api/v1/communities', {
    headers: headers(owner),
    data: input,
  });
  expect(response.status()).toBe(200);
  const receipt: components['schemas']['CommandReceipt'] = await response.json();

  expect(receipt.conversation?.id).toBe(input.conversation_id);
  return receipt.conversation!;
}

async function commandCommunity(options: {
  account: Account;
  conversationId: string;
  action: components['schemas']['CommunityAction'];
}) {
  const response = await options.account.context.request.post('/api/v1/communities/commands', {
    headers: headers(options.account),
    data: {
      operation_id: randomUUID(),
      conversation_id: options.conversationId,
      action: options.action,
    },
  });
  expect(response.status()).toBe(200);
}

async function openMessages(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Messages', exact: true })).toBeVisible();
}

async function openConversation(page: Page, title: string) {
  const directory = page.getByRole('complementary', { name: 'Conversations' });
  await directory.getByRole('button', { name: new RegExp(`^${title}`) }).click();
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
}

async function openListComposer(page: Page, kind: 'Poll' | 'Checklist') {
  await page.getByRole('button', { name: 'Attach', exact: true }).click();
  await page.getByRole('menuitem', { name: kind, exact: true }).click();
  return page.getByRole('dialog', { name: `New ${kind}`, exact: true });
}

async function createPoll(page: Page) {
  const composer = page.getByRole('textbox', { name: 'Message', exact: true });
  await composer.fill('Retained planning draft');
  const dialog = await openListComposer(page, 'Poll');
  await dialog.getByRole('textbox', { name: 'Ask a Question' }).fill(POLL_QUESTION);
  await dialog.getByRole('textbox', { name: 'Option 1' }).fill('Morning');
  await dialog.getByRole('textbox', { name: 'Option 2' }).fill('Afternoon');
  await dialog.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(composer).toHaveText('Retained planning draft');
}

async function createChecklist(page: Page) {
  const dialog = await openListComposer(page, 'Checklist');
  const firstTask = dialog.getByRole('textbox', { name: 'Task 1', exact: true });
  // The opening dialog focuses the first task after the title field becomes editable.
  await expect(firstTask).toBeFocused();
  await dialog.getByRole('textbox', { name: 'Title', exact: true }).fill(CHECKLIST_TITLE);
  await firstTask.fill('Book the room');
  await dialog.getByRole('button', { name: 'Add Task', exact: true }).click();
  const secondTask = dialog.getByRole('textbox', { name: 'Task 2', exact: true });
  await expect(secondTask).toBeFocused();
  await secondTask.fill('Print the agenda');
  await dialog.getByText('Allow Others to Mark as Done', { exact: true }).click();
  await dialog.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(dialog).toHaveCount(0);
}

async function vote(page: Page, option: string) {
  const poll = page.getByRole('region', { name: POLL_QUESTION, exact: true });
  await expect(poll.getByText('Public Poll', { exact: true })).toBeVisible();
  await poll.getByRole('button', { name: option, exact: true }).click();
  await poll.getByRole('button', { name: 'Vote', exact: true }).click();
  await expect(poll.getByRole('button', { name: 'Change vote', exact: true })).toBeVisible();
}

test('votes and checklist tasks converge, and revocation removes private history', async ({
  browser,
  context,
  baseURL,
}) => {
  const participantContext = await browser.newContext({ baseURL });
  try {
    const owner = await register(context, baseURL!);
    const participant = await register(participantContext, baseURL!);
    const group = await createGroup(owner);
    await commandCommunity({
      account: participant,
      conversationId: group.id,
      action: { kind: 'join' },
    });
    await Promise.all([openMessages(owner.page), openMessages(participant.page)]);
    await Promise.all([
      openConversation(owner.page, group.title),
      openConversation(participant.page, group.title),
    ]);

    await createPoll(owner.page);
    await vote(participant.page, 'Morning');
    await vote(owner.page, 'Afternoon');
    const participantPoll = participant.page.getByRole('region', { name: POLL_QUESTION });
    await expect(participantPoll.getByText('2 members voted')).toBeVisible({
      timeout: CONVERGENCE_TIMEOUT_MS,
    });

    await createChecklist(owner.page);
    const ownerChecklist = owner.page.getByRole('region', { name: CHECKLIST_TITLE });
    const participantChecklist = participant.page.getByRole('region', { name: CHECKLIST_TITLE });
    await Promise.all([
      ownerChecklist.getByRole('checkbox', { name: 'Book the room' }).click(),
      participantChecklist.getByRole('checkbox', { name: 'Print the agenda' }).click(),
    ]);
    await expect(ownerChecklist.getByText('2 of 2 tasks completed')).toBeVisible({
      timeout: CONVERGENCE_TIMEOUT_MS,
    });
    await expect(participantChecklist.getByText('2 of 2 tasks completed')).toBeVisible({
      timeout: CONVERGENCE_TIMEOUT_MS,
    });

    await participant.page.bringToFront();
    await participantPoll.getByRole('button', { name: 'View voters', exact: true }).click();
    const voters = participant.page.getByRole('dialog', { name: 'Poll voters' });
    await expect(voters.getByText(owner.grant.user.display_name, { exact: true })).toBeVisible();

    const captured = latch<string>();
    const revoked = latch<void>();
    const delivered = latch<void>();
    await participant.page.route('**/api/v1/messages/*/poll/voters?*', async (route) => {
      const url = new URL(route.request().url());
      if (!url.searchParams.has('option_id')) {
        await route.continue();
        return;
      }

      const response = await route.fetch();
      expect(response.status()).toBe(200);
      captured.release(url.pathname);
      await revoked.ready;
      await route.fulfill({ response }).catch(() => {
        // Revocation may already have aborted this browser request.
      });
      delivered.release();
    });

    try {
      await voters.getByRole('combobox').selectOption({ label: 'Afternoon' });
      const voterPath = await captured.ready;
      await commandCommunity({
        account: owner,
        conversationId: group.id,
        action: { kind: 'ban', user_id: participant.grant.user.id },
      });
      await expect(voters).toHaveCount(0, { timeout: CONVERGENCE_TIMEOUT_MS });
      await expect(participantPoll).toHaveCount(0);
      await expect(participantChecklist).toHaveCount(0);

      revoked.release();
      await delivered.ready;
      const denied = await participant.context.request.get(voterPath);
      expect(denied.status()).toBe(404);
      await expect(voters).toHaveCount(0);
    } finally {
      revoked.release();
    }
  } finally {
    await participantContext.close();
  }
});

async function sendText(input: {
  account: Account;
  destination: components['schemas']['Destination'];
  text: string;
}): Promise<components['schemas']['SendReceipt']> {
  const message: components['schemas']['SendMessage'] = {
    operation_id: randomUUID(),
    message_id: randomUUID(),
    destination: input.destination,
    content: {
      schema_version: 1,
      text: input.text,
      custom_emoji: [],
    },
  };
  const response = await input.account.context.request.post('/api/v1/messages', {
    headers: headers(input.account),
    data: message,
  });
  expect(response.status()).toBe(200);
  return response.json();
}

async function deleteMessage(options: {
  account: Account;
  conversationId: string;
  messageId: string;
}) {
  const response = await options.account.context.request.post('/api/v1/chat/commands', {
    headers: headers(options.account),
    data: {
      operation_id: randomUUID(),
      conversation_id: options.conversationId,
      action: { kind: 'delete', message_id: options.messageId },
    },
  });
  expect(response.status()).toBe(200);
}

async function uploadDocument(page: Page) {
  await page.getByLabel('Choose an attachment').setInputFiles({
    name: FORWARDED_DOCUMENT,
    mimeType: 'text/plain',
    buffer: Buffer.from(FORWARDED_BYTES),
  });
  const preview = page.getByRole('dialog', { name: 'Send attachments', exact: true });
  await preview.getByRole('button', { name: 'Send attachments', exact: true }).click();

  const row = page.locator('[data-message-id]').filter({ hasText: FORWARDED_DOCUMENT });
  await expect(row.getByRole('img', { name: 'Stored on server' })).toBeVisible();
  return row;
}

test('replays the destination receipt and keeps the attachment after source deletion', async ({
  browser,
  context,
  baseURL,
}) => {
  const recipientContext = await browser.newContext({ baseURL });
  const mayReplay = latch<void>();
  try {
    const sender = await register(context, baseURL!);
    const recipient = await register(recipientContext, baseURL!);
    const direct = await sendText({
      account: sender,
      destination: { kind: 'recipient', user_id: recipient.grant.user.id },
      text: 'Forwarding destination',
    });
    const saved = await sendText({
      account: sender,
      destination: { kind: 'saved' },
      text: 'Forwarding source',
    });
    await Promise.all([openMessages(sender.page), openMessages(recipient.page)]);
    await Promise.all([
      openConversation(sender.page, 'Saved Messages'),
      openConversation(recipient.page, sender.grant.user.display_name),
    ]);
    await sender.page.bringToFront();
    const sourceRow = await uploadDocument(sender.page);
    const sourceMessageId = await sourceRow.getAttribute('data-message-id');
    expect(sourceMessageId).toBeTruthy();

    const firstCommit = latch<components['schemas']['ForwardBatch']>();
    const replay = latch<components['schemas']['ForwardReceipt']>();
    let original: components['schemas']['ForwardBatch'] | undefined;
    await sender.page.route('**/api/v1/messages/forward', async (route) => {
      const input: components['schemas']['ForwardBatch'] = route.request().postDataJSON();
      if (!original) {
        original = input;
        const response = await route.fetch();
        expect(response.status()).toBe(200);
        await route.abort('failed');
        firstCommit.release(input);
        return;
      }

      // Delay receipt recovery until the original attachment reference has been deleted.
      await mayReplay.ready;
      expect(input).toEqual(original);
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      replay.release(await response.json());
      await route.fulfill({ response });
    });

    const savedRow = sender.page.locator(`[data-message-id="${saved.message.id}"]`);
    await savedRow.click({ button: 'right' });
    await sender.page.getByRole('menuitem', { name: 'Select', exact: true }).click();
    const sourceSelection = sourceRow.getByRole('checkbox', { name: /Select message from/ });
    await sourceSelection.click();
    await expect(sourceSelection).toBeChecked();
    await sender.page.getByRole('button', { name: 'Forward selected messages' }).click();
    const dialog = sender.page.getByRole('dialog', { name: 'Share with' });
    const recipientLabel = new RegExp(`^${recipient.grant.user.display_name}`);
    await dialog.getByRole('button', { name: recipientLabel }).click();
    const comment = 'Please review these messages';
    await dialog.getByRole('textbox', { name: 'Forward caption' }).fill(comment);
    await dialog.getByRole('button', { name: 'Send forwarded messages', exact: true }).click();

    const committed = await firstCommit.ready;
    expect(committed.comment?.content.text).toBe(comment);
    expect(committed.items.map((item) => item.source_message_id)).toEqual([
      saved.message.id,
      sourceMessageId,
    ]);
    const pending = sender.page.getByRole('region', { name: 'Pending forwards' });
    await expect(pending.getByText(recipient.grant.user.display_name)).toBeVisible();
    await expect(pending.getByText('Waiting for server confirmation')).toBeVisible();
    await deleteMessage({
      account: sender,
      conversationId: saved.message.conversation_id,
      messageId: sourceMessageId!,
    });
    await expect(sourceRow).toHaveCount(0);
    mayReplay.release();

    const receipt = await replay.ready;
    const forwardedId = committed.items[1].message_id;
    const commentId = committed.comment!.message_id;
    expect(receipt.message_ids).toEqual([
      commentId,
      ...committed.items.map((item) => item.message_id),
    ]);
    await expect(pending).toHaveCount(0);
    const receivedComment = recipient.page.locator(`[data-message-id="${commentId}"]`);
    await expect(receivedComment.getByText(comment)).toBeVisible();

    const forwarded = recipient.page.locator(`[data-message-id="${forwardedId}"]`);
    await expect(forwarded).toBeVisible({ timeout: CONVERGENCE_TIMEOUT_MS });
    await recipient.page.bringToFront();
    const started = recipient.page.waitForEvent('download');
    await forwarded.getByRole('button', { name: `Download ${FORWARDED_DOCUMENT}` }).click();
    const download = await started;
    expect(download.suggestedFilename()).toBe(FORWARDED_DOCUMENT);
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
    }
    expect(Buffer.concat(chunks).toString()).toBe(FORWARDED_BYTES);

    const historyPath = `/api/v1/conversations/${direct.message.conversation_id}/history`;
    const response = await recipient.context.request.get(historyPath);
    expect(response.status()).toBe(200);
    const history: components['schemas']['HistoryPage'] = await response.json();
    const comments = history.messages.filter((message) => message.content.text === comment);
    expect(comments.map((message) => message.id)).toEqual([commentId]);
    const copies = history.messages.filter((message) =>
      message.attachments?.some((attachment) => attachment.file_name === FORWARDED_DOCUMENT),
    );
    expect(copies.map((message) => message.id)).toEqual([forwardedId]);
  } finally {
    mayReplay.release();
    await recipientContext.close();
  }
});

test('opens a distant Chinese search hit and honors link preview opt-out', async ({
  context,
  baseURL,
}) => {
  const owner = await register(context, baseURL!);
  const destination = { kind: 'saved' } as const;
  const target = await sendText({ account: owner, destination, text: SEARCH_HIT });
  for (let index = 0; index < NEWER_HISTORY_MESSAGES; index += 1) {
    await sendText({ account: owner, destination, text: `Newer history entry ${index + 1}` });
  }

  const page = owner.page;
  await openMessages(page);
  await openConversation(page, 'Saved Messages');
  const newest = page.getByRole('group', {
    name: `Message: Newer history entry ${NEWER_HISTORY_MESSAGES}`,
    exact: true,
  });
  await expect(newest).toBeInViewport();
  const hit = page.locator(`[data-message-id="${target.message.id}"]`);
  await expect(hit).toHaveCount(0);

  const composer = page.getByRole('textbox', { name: 'Message', exact: true });
  await composer.fill(NO_PREVIEW_URL);
  await page.getByLabel('Disable link preview', { exact: true }).check();
  const sent = page.waitForResponse((response) => {
    return response.url().endsWith('/api/v1/messages') && response.request().method() === 'POST';
  });
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  const response = await sent;
  expect(response.status()).toBe(200);
  expect(response.request().postDataJSON()).toMatchObject({ disable_link_preview: true });
  const receipt: components['schemas']['SendReceipt'] = await response.json();
  const linkRow = page.locator(`[data-message-id="${receipt.message.id}"]`);
  await expect(linkRow.getByRole('link', { name: NO_PREVIEW_URL, exact: true })).toHaveAttribute(
    'href',
    NO_PREVIEW_URL,
  );
  expect(receipt.message).not.toHaveProperty('link_preview', expect.any(Object));

  await page
    .getByRole('textbox', { name: 'Search chats and messages', exact: true })
    .fill(SEARCH_TERM);
  const results = page.getByRole('region', { name: 'Messages matching your search' });
  await results.getByRole('button', { name: new RegExp(SEARCH_HIT) }).click();
  await expect(hit).toBeInViewport({ timeout: CONVERGENCE_TIMEOUT_MS });
  await expect(hit).toContainText(SEARCH_HIT);
});
