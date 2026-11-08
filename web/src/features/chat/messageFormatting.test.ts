import { expect, it } from 'vitest';
import { formatConversationTime, formatMessageTime } from './messageFormatting';

it('renders midnight as 00 rather than 24 in 24-hour mode', () => {
  const midnight = new Date('2026-11-08T00:05:00').getTime();
  expect(formatMessageTime(midnight, { timeFormat: 'h23' })).toBe('00:05');
  expect(formatMessageTime(midnight, { timeFormat: 'h12' })).toBe('12:05 AM');
});

it('converts conversation clock labels without changing weekday labels', () => {
  const options = { timeFormat: 'h23' as const };
  expect(formatConversationTime('12:05 AM', options)).toBe('00:05');
  expect(formatConversationTime('12:05 PM', options)).toBe('12:05');
  expect(formatConversationTime('02:30 PM', options)).toBe('14:30');
  expect(formatConversationTime('Fri', options)).toBe('Fri');
});
