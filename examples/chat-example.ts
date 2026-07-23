/**
 * Example: Create a new chat and send a prompt to syntx.ai.
 *
 * This script demonstrates the recommended flow:
 * 1. Initialize the SDK with authentication
 * 2. Create a new text chat session via REST
 * 3. Send a message prompt and poll for the response
 *
 * The previous WebSocket example has been removed — the `SyntxWebSocket`
 * class never reached a functional state against the live syntx.ai API
 * (see src/websocket.ts) and is retained only for potential future
 * protocol support. Prefer REST polling for all production usage.
 */

import { SyntxClient } from '../src/index';

async function main() {
  // 1. Initialize client (token from Telegram OAuth or other auth method)
  const token = process.env.SYNTX_TOKEN || 'your-auth-token';
  const lang = process.env.SYNTX_LANG || 'en';

  const syntx = new SyntxClient({ token, lang });

  // 2. Validate the token
  const profile = await syntx.user.mePublic();
  console.log(`Authenticated as ${profile.username ?? profile.email ?? profile.id}`);

  // 3. Read token balance
  const balance = await syntx.user.getBalance();
  console.log(`Balance: ${balance.balance} tokens`);

  // 4. Create a new chat session
  console.log('Creating new chat session...');
  const chat = await syntx.chats.create({ scope: 'text' });
  const chatUuid = chat.uuid;
  console.log(`Chat created: ${chatUuid}`);

  // 5. Send a prompt and poll for the response
  const prompt = 'Hello! What can you do?';
  console.log(`\nSending: "${prompt}"`);
  await syntx.chats.sendMessage(chatUuid, 'chatgpt', [
    {
      object_type: 'text',
      object_url: null,
      object_text: prompt,
    },
  ]);
  const result = await syntx.chats.waitForResponse(chatUuid, {
    timeout: 60000,
    pollInterval: 3000,
  });
  console.log('\n--- Text reply ---');
  console.log(result.text || '(no text — media-only reply)');
  if (result.media.length > 0) {
    console.log(`\n--- Media (${result.media.length}) ---`);
    for (const m of result.media) {
      console.log(`${m.object_type}: ${m.object_url}`);
    }
  }
  console.log('--- End ---');
}

main().catch(console.error);
