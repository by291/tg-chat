import { randomUUID } from 'node:crypto';
import { expect } from '@playwright/test';
import type { components } from '../src/api/schema';
import {
  chatHeading,
  closeProfile,
  communities,
  CONVERGENCE_TIMEOUT_MS,
  createCommunity,
  discoverAndJoin,
  openProfile,
  publish,
  test,
} from './communityFixtures';

const CHANNEL_ACCOUNTS = 3;

test.use({ accountCount: CHANNEL_ACCOUNTS });

test('channel subscriptions preserve publication and subscriber privacy', async ({
  accounts,
}, testInfo) => {
  const [owner, member, outsider] = accounts;
  const channel = await createCommunity({
    page: owner.page,
    kind: 'channel',
    title: `News channel ${randomUUID().slice(0, 8)}`,
  });
  await discoverAndJoin({ page: member.page, title: channel.title, label: 'Subscribe' });
  await expect(chatHeading(member.page, channel.title)).toBeVisible();
  await openProfile({ page: owner.page, title: channel.title, section: 'Community settings' });
  await owner.page.getByLabel('Public discovery').uncheck();
  await owner.page.getByRole('button', { name: 'Save community settings', exact: true }).click();
  await closeProfile(owner.page);
  await openProfile({ page: owner.page, title: channel.title, section: 'Invite links' });
  await owner.page.getByLabel('Invite username').fill(outsider.grant.user.username);
  await owner.page.getByRole('button', { name: 'Send invitation', exact: true }).click();
  await expect(
    owner.page.getByText('Invitation sent. The recipient must accept it.'),
  ).toBeVisible();
  await communities(outsider.page);
  await outsider.page.getByRole('button', { name: 'Invitations', exact: true }).click();
  await outsider.page
    .getByRole('article', { name: `Invitation ${channel.title}` })
    .getByRole('button', { name: 'Accept invitation' })
    .click();
  await expect(chatHeading(outsider.page, channel.title)).toBeVisible();
  const subscribers = await outsider.context.request.get(
    `/api/v1/communities/${channel.id}/members`,
  );
  expect(subscribers.status()).toBe(200);
  const subscriberPage = (await subscribers.json()) as components['schemas']['CommunityMemberPage'];
  expect(subscriberPage.items.map((entry) => entry.id)).toEqual([outsider.grant.user.id]);
  const muteChannel = outsider.page.getByRole('button', { name: 'Mute channel for one day' });
  await expect(muteChannel).toBeVisible();
  await muteChannel.click();
  const unmuteChannel = outsider.page.getByRole('button', { name: 'Unmute channel' });
  await expect(unmuteChannel).toBeVisible();
  await unmuteChannel.click();
  await expect(muteChannel).toBeVisible();
  await expect(outsider.page.getByRole('textbox', { name: 'Message', exact: true })).toHaveCount(0);
  await closeProfile(owner.page);
  await publish(owner.page, 'Channel publication');
  await outsider.page.bringToFront();
  const channelMessage = outsider.page.getByRole('group', {
    name: 'Message: Channel publication',
    exact: true,
  });
  await expect(channelMessage).toBeVisible({ timeout: CONVERGENCE_TIMEOUT_MS });
  await channelMessage.scrollIntoViewIfNeeded();
  await expect(channelMessage).toBeInViewport();
  const channelRow = outsider.page
    .getByRole('complementary', { name: 'Conversations' })
    .getByRole('button', { name: new RegExp(`^${channel.title}`) });
  const titleBounds = await channelRow.locator('strong').boundingBox();
  const timeBounds = await channelRow.locator('time').boundingBox();
  expect(titleBounds).not.toBeNull();
  expect(timeBounds).not.toBeNull();
  expect(titleBounds!.x + titleBounds!.width).toBeLessThanOrEqual(timeBounds!.x);
  await outsider.page.screenshot({ path: testInfo.outputPath('channel-desktop.png') });
  await outsider.page.setViewportSize({ width: 390, height: 844 });
  const profile = await openProfile({ page: outsider.page, title: channel.title });
  await expect(profile.getByText('3 subscribers', { exact: true })).toBeVisible();
  await expect(profile.getByRole('button', { name: 'Subscribers', exact: true })).toHaveCount(0);
  await outsider.page.screenshot({ path: testInfo.outputPath('community-mobile.png') });
});
