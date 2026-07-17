/**
 * Stream a chat reply in real time using the syntx.ai WebSocket endpoint.
 *
 * Run with:
 *   SYNTX_TOKEN=... npx tsx examples/stream-example.ts "Напиши короткий тост"
 *
 * Demonstrates:
 *  - opening a one-shot WSS session via `chats.streamResponse`
 *  - receiving incremental chunks via `onChunk`
 *  - printing the elapsed time and total length on completion
 */
import { SyntxClient } from '../src';

const prompt = process.argv.slice(2).join(' ') || 'Расскажи короткий анекдот про программистов';

async function main() {
  const token = process.env.SYNTX_TOKEN;
  if (!token) {
    console.error('SYNTX_TOKEN env var is required');
    process.exit(1);
  }

  const syntx = new SyntxClient({ token });
  console.log(`▶ Prompt: ${prompt}\n`);

  const result = await syntx.chats.streamResponse(prompt, {
    scope: 'text',
    timeout: 120_000,
    onChunk: (chunk, accumulated) => {
      // Render each chunk as it arrives. Uncomment the next line for a
      // typewriter effect (overwrites the previous line in-place).
      process.stdout.write(chunk);
      // process.stdout.write(`\r${' '.repeat(80)}\r${accumulated}`);
      void accumulated;
    },
  });

  console.log(
    `\n\n✓ Done in ${result.elapsedMs}ms — ${result.text.length} chars`,
  );
}

main().catch((err) => {
  console.error('Stream failed:', err);
  process.exit(1);
});