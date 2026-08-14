import { describe, it, expect, vi } from 'vitest';
import {
  buildFollowGreetingMessages,
  buildMenuSelectionMessage,
  sendFollowGreeting,
} from './follow-greeting.js';
import type { LineClient } from '@line-crm/line-sdk';

describe('follow-greeting', () => {
  it('あいさつとメニューの2通を返す', () => {
    const messages = buildFollowGreetingMessages();
    expect(messages).toHaveLength(2);
    expect(messages[0].type).toBe('text');
    expect(messages[0].text).toContain('はじめまして');
  });

  it('クイックリプライに2つの窓口が出る（NFCグッズ / kimito.link）', () => {
    const menu = buildMenuSelectionMessage();
    const labels = menu.quickReply.items.map((i) => i.action.label);
    expect(labels).toEqual(['NFCグッズのご相談', 'kimito.linkのご相談']);
  });

  it('選択肢の送信テキストはラベルと一致する（応答側のマッチが外れないため）', () => {
    const menu = buildMenuSelectionMessage();
    for (const item of menu.quickReply.items) {
      expect(item.action.text).toBe(item.action.label);
    }
  });

  // ★このテストが本丸。reply を使うと friend_add シナリオの即時配信と
  // replyToken を奪い合い、二重送信または無言失敗になる。
  it('push で送る。replyMessage は絶対に呼ばない', async () => {
    const pushMessage = vi.fn().mockResolvedValue({});
    const replyMessage = vi.fn().mockResolvedValue({});
    const client = { pushMessage, replyMessage } as unknown as LineClient;

    await sendFollowGreeting(client, 'U_test_user');

    expect(pushMessage).toHaveBeenCalledTimes(1);
    expect(pushMessage).toHaveBeenCalledWith('U_test_user', expect.any(Array));
    expect(replyMessage).not.toHaveBeenCalled();
  });

  it('送信に失敗しても例外を投げない（follow 処理全体を巻き込まない）', async () => {
    const client = {
      pushMessage: vi.fn().mockRejectedValue(new Error('LINE API down')),
    } as unknown as LineClient;

    await expect(sendFollowGreeting(client, 'U_test_user')).resolves.toBeUndefined();
  });
});
