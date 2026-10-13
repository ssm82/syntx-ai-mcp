import type { SyntxTool } from '../registry';
import { textResult, toMcpError } from '../errors';

/**
 * Prompt-enhancer tools.
 *
 * The `enhance/start` endpoint is captcha-gated (rule
 * `^prompt-enhancer\/(enhance|generate)(\/start)?$`, action `generate`):
 * unaugmented calls 403 with a structured `detail`. Configure
 * `SYNTX_CAPTCHA_TOKEN` (or a `captchaProvider`) before invoking
 * `start-prompt-enhancement`, or it will surface
 * `SyntxCaptchaRequiredError`.
 */
export const promptEnhancerTools: SyntxTool[] = [
  {
    name: 'get-prompt-enhancer-cost',
    description:
      'Return the token cost of enhancing a prompt for a given model. Wraps ' +
      '`syntx.promptEnhancer.getCost`. Hits `GET /api/v1/prompt-enhancer/cost?model_type=…`. ' +
      '422/`model_not_enhanceable` when the model is not enhanceable.',
    inputSchema: {
      type: 'object',
      properties: {
        model_type: { type: 'string', description: 'Model identifier (required).' },
      },
      required: ['model_type'],
      additionalProperties: false,
    },
    async handler(args, ctx) {
      const modelType = String(args.model_type ?? '').trim();
      if (!modelType) {
        return toMcpError(new Error('"model_type" must be a non-empty string'), 'get-prompt-enhancer-cost');
      }
      try {
        return textResult(JSON.stringify(await ctx.syntx.promptEnhancer.getCost(modelType), null, 2));
      } catch (err) {
        return toMcpError(err, 'get-prompt-enhancer-cost');
      }
    },
  },
  {
    name: 'start-prompt-enhancement',
    description:
      'Start a prompt-enhancement task. Wraps `syntx.promptEnhancer.start`. Hits ' +
      '`POST /api/v1/prompt-enhancer/enhance/start` (captcha-gated, action `generate`). ' +
      'Returns `{task_id}`; poll with `get-prompt-enhancement-task`.',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'The prompt to enhance (required).' },
        model_type: { type: 'string', description: 'Target model identifier (required).' },
      },
      required: ['prompt', 'model_type'],
      additionalProperties: false,
    },
    async handler(args, ctx) {
      const prompt = String(args.prompt ?? '').trim();
      if (!prompt) {
        return toMcpError(new Error('"prompt" must be a non-empty string'), 'start-prompt-enhancement');
      }
      const modelType = String(args.model_type ?? '').trim();
      if (!modelType) {
        return toMcpError(new Error('"model_type" must be a non-empty string'), 'start-prompt-enhancement');
      }
      try {
        const out = await ctx.syntx.promptEnhancer.start({ prompt, model_type: modelType });
        return textResult(JSON.stringify(out, null, 2));
      } catch (err) {
        return toMcpError(err, 'start-prompt-enhancement');
      }
    },
  },
  {
    name: 'get-prompt-enhancement-task',
    description:
      'Poll a prompt-enhancement task. Wraps `syntx.promptEnhancer.getTask`. ' +
      'Hits `GET /api/v1/prompt-enhancer/tasks/{id}`. `status` is one of ' +
      '`pending` | `completed` | `failed`. The `completed_prompt` field carries ' +
      'the enhanced text on `completed`.',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: { type: 'string', description: 'Task id from start-prompt-enhancement (required).' },
      },
      required: ['task_id'],
      additionalProperties: false,
    },
    async handler(args, ctx) {
      const taskId = String(args.task_id ?? '').trim();
      if (!taskId) {
        return toMcpError(new Error('"task_id" must be a non-empty string'), 'get-prompt-enhancement-task');
      }
      try {
        return textResult(JSON.stringify(await ctx.syntx.promptEnhancer.getTask(taskId), null, 2));
      } catch (err) {
        return toMcpError(err, 'get-prompt-enhancement-task');
      }
    },
  },
];
