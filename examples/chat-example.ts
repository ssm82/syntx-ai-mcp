/**
 * Example: Create a new chat and send a prompt to syntx.ai using the
 * text-flow `llm/*` namespace (the legacy `chats/{id}/messages` write path
 * with `objects[]` + `model_type` was removed in v0.4.0).
 *
 * Demonstrates:
 *  1. Initialize the SDK with authentication
 *  2. Validate the token via `user.mePublic()` and read balance
 *  3. Create a chat session via REST
 *  4. Submit the prompt via `llm.generate` (binds the reply to the chat)
 *  5. Wait for the assistant reply via `llm.waitForResponse`
 *     (SSE primary, REST polling fallback)
 *
 * Run with:
 *   SYNTX_TOKEN=... npx tsx examples/chat-example.ts
 */

import { SyntxClient } from '../src/index';

async function main() {
  const token = process.env.SYNTX_TOKEN || 'your-auth-token';

  const syntx = new SyntxClient({ token });

  const profile = await syntx.user.mePublic();
  console.log(`Authenticated as ${profile.username ?? profile.email ?? profile.id}`);

  const balance = await syntx.user.getBalance();
  console.log(`Balance: ${balance.balance} tokens`);

  console.log('Creating new chat session…');
  const chat = await syntx.chats.create({ scope: 'text' });
  const chatUuid = chat.uuid;
  console.log(`Chat created: ${chatUuid}`);

  const prompt = 'Hello! What can you do?';
  console.log(`\nSending: "${prompt}"`);

  await syntx.llm.generate({
    prompt,
    aiName: 'chatgpt',
    chatUuid,
  });

  const result = await syntx.llm.waitForResponse(chatUuid, {
    timeout: 60000,
  });

  console.log('\n--- Assistant reply ---');
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