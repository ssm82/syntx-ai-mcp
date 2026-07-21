/**
 * Example: Create a new chat and send a prompt to GPT-5.5
 *
 * This script demonstrates the complete flow:
 * 1. Initialize the SDK with authentication
 * 2. Create a new text chat session
 * 3. Send a message prompt
 * 4. Receive streaming response
 *
 * Note: Real GPT-5.5 usage requires valid authentication.
 * The WebSocket flow below is inferred from reverse engineering
 * and may need adjustment based on actual API behavior.
 */

import { SyntxClient } from './index';
import { SyntxWebSocket } from './websocket';

async function main() {
  // Initialize client (token from Telegram OAuth or other auth method)
  const token = process.env.SYNTX_TOKEN || 'your-auth-token';
  const lang = 'en';

  const syntx = new SyntxClient({
    baseURL: 'https://api.syntx.ai',
    token,
    timeout: 30000,
  });

  console.log('=== syntx.ai SDK Demo ===\n');

  // 1. Check authentication
  try {
    const user = await syntx.user.me();
    console.log(`Authenticated as: ${user.name} (${user.username || 'no username'})`);
  } catch (error) {
    console.error('Auth failed. Set SYNTX_TOKEN environment variable.');
    console.error(error);
    return;
  }

  // 2. Check subscription and balance
  const balance = await syntx.user.getBalance();
  console.log(`Balance: ${balance.balance} tokens`);

  const subscription = await syntx.user.getSubscription();
  console.log(`Plan: ${subscription.type}, Active: ${subscription.active}`);
  console.log(`Valid: ${subscription.start_date} → ${subscription.end_date}\n`);

  // 3. List available AI models
  const services = await syntx.ai.listServices();
  const chatModels = services.filter(s => s.scope === 'text' || s.scope === 'chat');
  console.log(`Available text/chat AI (${chatModels.length}):`);
  chatModels.slice(0, 10).forEach(m => {
    console.log(`  - ${m.value}: ${m.label}`);
  });
  console.log();

  // 4. Create a new chat session
  console.log('Creating new chat session...');
  let chatUuid: string;

  // Option A: REST API (synchronous, non-streaming)
  try {
    const chat = await syntx.chats.create({ scope: 'text' });
    chatUuid = chat.uuid;
    console.log(`Chat created via REST: ${chatUuid}`);
  } catch (error) {
    console.log('REST chat creation failed, trying WebSocket...');

    // Option B: WebSocket (streaming, real-time)
    const ws = new SyntxWebSocket(token, lang);

    ws.onConnect(() => console.log('WebSocket connected'));
    ws.onDisconnect(() => console.log('WebSocket disconnected'));
    ws.onError((err) => console.error('WebSocket error:', err));

    ws.onMessage((msg) => {
      if (msg.type === 'session' && msg.uuid) {
        chatUuid = msg.uuid as string;
        console.log(`Session created via WebSocket: ${chatUuid}`);
      }
      if (msg.content) {
        process.stdout.write(msg.content as string);
      }
      if (msg.done) {
        console.log('\n--- Response complete ---');
      }
    });

    chatUuid = await ws.createSession('text');
    console.log(`Chat session: ${chatUuid}`);
  }

  // 5. Send a message (via WebSocket for streaming)
  const prompt = 'Hello! What can you do?';
  console.log(`\nSending: "${prompt}"`);

  const ws = new SyntxWebSocket(token, lang);
  let responseText = '';

  ws.onMessage((msg) => {
    if (msg.content) {
      responseText += msg.content;
      process.stdout.write(msg.content as string);
    }
    if (msg.done) {
      console.log('\n--- Response complete ---');
      ws.disconnect();
    }
  });

  ws.connect('chats/stream');

  // Wait for session, then send prompt
  setTimeout(() => {
    ws.sendPrompt(chatUuid!, prompt, {
      ai_name: 'gpt',  // or 'gpt-5.5' depending on available models
    });
  }, 1000);

  // Keep running for 60 seconds
  setTimeout(() => {
    console.log('\nDemo complete.');
    process.exit(0);
  }, 60000);
}

main().catch(console.error);