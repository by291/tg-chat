import { randomUUID } from 'node:crypto';
import { expect } from '@playwright/test';
import {
  chatHeading,
  closeProfile,
  command,
  communities,
  CONVERGENCE_TIMEOUT_MS,
  createCommunity,
  createPrivateInvitation,
  discoverAndJoin,
  openCommunity,
  openProfile,
  publish,
  test,
} from './communityFixtures';

const STABLE_POSTING_MUTE_MS = 60 * 60 * 1000;

test('group admission, moderation and private invitations preserve membership boundaries', async ({
  accounts,
}) => {
  const [owner, admin, member, outsider, banned] = accounts;
  await member.page.clock.install({ time: new Date() });
  const group = await createCommunity({
    page: owner.page,
    kind: 'group',
    title: `Study group ${randomUUID().slice(0, 8)}`,
  });
  await publish(owner.page, 'Retained group history');

  await discoverAndJoin({
    page: admin.page,
    title: group.title,
    label: 'Join group',
  });
  await expect(chatHeading(admin.page, group.title)).toBeVisible();
  const groupEditor = owner.page.getByRole('textbox', { name: 'Message', exact: true });
  await groupEditor.fill('Keep this draft while managing members');
  await openProfile({ page: owner.page, title: group.title, section: 'Members' });
  const administrator = owner.page.getByRole('article', {
    name: `Member ${admin.grant.user.username}`,
  });
  const adminActions = administrator.getByRole('button', {
    name: `Actions for ${admin.grant.user.display_name}`,
  });
  await adminActions.click();
  await owner.page.getByRole('menuitem', { name: 'Make administrator', exact: true }).click();
  await adminActions.click();
  await expect(
    owner.page.getByRole('menuitem', { name: 'Remove administrator', exact: true }),
  ).toBeVisible();
  await owner.page.keyboard.press('Escape');
  await closeProfile(owner.page);
  await expect(groupEditor).toHaveText('Keep this draft while managing members');

  await openProfile({ page: owner.page, title: group.title, section: 'Community settings' });
  await owner.page.getByLabel('Approve public and invite-link join requests').check();
  await owner.page.getByRole('button', { name: 'Save community settings', exact: true }).click();

  await discoverAndJoin({
    page: member.page,
    title: group.title,
    label: 'Request to join',
  });
  await expect(member.page.getByText('Request sent', { exact: true })).toBeVisible();
  await member.page.reload();
  await member.page.getByRole('textbox', { name: 'Search chats and messages' }).fill(group.title);
  await expect(member.page.getByText('Request sent', { exact: true })).toBeVisible();

  await openCommunity(admin.page, group.title);
  await openProfile({ page: admin.page, title: group.title, section: 'Join requests' });
  const request = admin.page.getByRole('article', {
    name: `Request ${member.grant.user.username}`,
  });
  await request.getByRole('button', { name: 'Approve', exact: true }).click();
  await closeProfile(admin.page);
  await publish(admin.page, 'Administrator publication');
  await member.page.getByRole('button', { name: `Open ${group.title}`, exact: true }).click();
  await expect(chatHeading(member.page, group.title)).toBeVisible();
  await expect(
    member.page.getByRole('group', { name: 'Message: Retained group history', exact: true }),
  ).toBeVisible();
  await expect(
    member.page
      .getByRole('group', {
        name: 'Message: Retained group history',
        exact: true,
      })
      .getByText(owner.grant.user.display_name, { exact: true }),
  ).toBeVisible();
  await expect(
    member.page
      .getByRole('group', {
        name: 'Message: Administrator publication',
        exact: true,
      })
      .getByText(admin.grant.user.display_name, { exact: true }),
  ).toBeVisible();
  await publish(member.page, 'Member publication');
  const mutedUntil = new Date(Date.now() + STABLE_POSTING_MUTE_MS).toISOString();
  await command({
    account: admin,
    conversationId: group.id,
    action: {
      kind: 'mute',
      user_id: member.grant.user.id,
      until: mutedUntil,
    },
  });
  await expect(member.page.getByRole('textbox', { name: 'Message', exact: true })).toHaveCount(0);
  const clientNow = await member.page.evaluate(() => Date.now());
  await member.page.clock.fastForward(Date.parse(mutedUntil) - clientNow + 1);
  await expect(member.page.getByRole('textbox', { name: 'Message', exact: true })).toBeVisible({
    timeout: CONVERGENCE_TIMEOUT_MS,
  });

  await command({
    account: banned,
    conversationId: group.id,
    action: { kind: 'join' },
  });
  await command({
    account: admin,
    conversationId: group.id,
    action: { kind: 'approve', user_id: banned.grant.user.id },
  });
  await openCommunity(banned.page, group.title);
  await expect(
    banned.page.getByRole('group', { name: 'Message: Retained group history', exact: true }),
  ).toBeVisible();
  await closeProfile(owner.page);
  await openProfile({ page: owner.page, title: group.title, section: 'Members' });
  const bannedMember = owner.page.getByRole('article', {
    name: `Member ${banned.grant.user.username}`,
  });
  await bannedMember
    .getByRole('button', { name: `Actions for ${banned.grant.user.display_name}` })
    .click();
  await owner.page.getByRole('menuitem', { name: 'Ban', exact: true }).click();
  await owner.page
    .getByRole('dialog', { name: 'Ban member?' })
    .getByRole('button', { name: 'Confirm', exact: true })
    .click();
  await expect(
    banned.page.getByRole('group', { name: 'Message: Retained group history', exact: true }),
  ).toHaveCount(0, { timeout: CONVERGENCE_TIMEOUT_MS });
  const denied = await banned.context.request.get(`/api/v1/conversations/${group.id}/history`);
  expect(denied.status()).toBe(404);
  await command({
    account: banned,
    conversationId: group.id,
    action: { kind: 'join' },
    expectedStatus: 404,
  });

  const current = await owner.context.request.get(`/api/v1/communities/${group.id}`);
  const link = await createPrivateInvitation(owner, await current.json());
  await communities(outsider.page);
  await outsider.page.getByLabel('Community search').fill(group.title);
  await expect(outsider.page.getByText('No other public communities found.')).toBeVisible();
  await outsider.page.goto(link);
  const invitation = outsider.page.getByRole('dialog', { name: group.title, exact: true });
  await expect(invitation).toBeVisible();
  const beforeJoin = await outsider.context.request.get(
    `/api/v1/conversations/${group.id}/history`,
  );
  expect(beforeJoin.status()).toBe(404);
  await invitation.getByRole('button', { name: 'Join group', exact: true }).click();
  await expect(chatHeading(outsider.page, group.title)).toBeVisible();
  await openProfile({ page: outsider.page, title: group.title });
  await outsider.page.getByRole('button', { name: 'Leave community', exact: true }).click();
  await outsider.page
    .getByRole('dialog', { name: 'Leave community?' })
    .getByRole('button', { name: 'Confirm', exact: true })
    .click();
  await expect(outsider.page.getByRole('dialog', { name: 'Group info' })).toHaveCount(0);
  await expect(chatHeading(outsider.page, group.title)).toHaveCount(0);
});
