import test, { describe } from 'node:test';
import assert from 'node:assert';
import { liveChatConfig } from './live-guard.js';

describe('liveChatConfig', () => {
  test('skips with no env', () => {
    const c = liveChatConfig({});
    assert.strictEqual(c.url, '');
    assert.ok(typeof c.skip === 'string');
  });
  test('skips when only the URL is set', () => {
    assert.ok(typeof liveChatConfig({ CHATBOT_URL: 'http://localhost:3000/api/chat' }).skip === 'string');
  });
  test('skips when only the flag is set (no default URL)', () => {
    const c = liveChatConfig({ RUN_LIVE_CHAT_TESTS: '1' });
    assert.strictEqual(c.url, '');
    assert.ok(typeof c.skip === 'string');
  });
  test('flag must be exactly 1', () => {
    assert.ok(typeof liveChatConfig({ RUN_LIVE_CHAT_TESTS: 'true', CHATBOT_URL: 'http://x/api/chat' }).skip === 'string');
  });
  test('runs only with flag and URL', () => {
    const c = liveChatConfig({ RUN_LIVE_CHAT_TESTS: '1', CHATBOT_URL: 'http://localhost:3000/api/chat' });
    assert.strictEqual(c.skip, false);
    assert.strictEqual(c.url, 'http://localhost:3000/api/chat');
  });
});
