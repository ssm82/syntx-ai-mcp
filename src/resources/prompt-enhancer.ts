import { BaseClient } from '../client';
import type {
  PromptEnhancementTask,
  PromptEnhancerCostResponse,
  StartPromptEnhancementParams,
  StartPromptEnhancementResponse,
} from '../types';

/**
 * Prompt enhancer.
 *
 * Captcha-gated per the S1 gate table
 * (`^prompt-enhancer\/(enhance|generate)(\/start)?$`, action `generate`):
 * unaugmented calls 403 with a structured `detail` carrying sitekey and
 * action. The captcha handling lives in `BaseClient.captchaProvider` —
 * this resource is a thin wire-through.
 */
export class PromptEnhancerResource {
  constructor(private readonly client: BaseClient) {}

  /**
   * Declare the token cost of enhancing a prompt for `modelType`.
   *
   * `GET /api/v1/prompt-enhancer/cost?model_type=…`
   *
   * 422/`model_not_enhanceable` when the model is not enhanceable;
   * `enhanceable: false` is the projectable shape when the response
   * 200s anyway.
   */
  async getCost(modelType: string): Promise<PromptEnhancerCostResponse> {
    return this.client.get<PromptEnhancerCostResponse>('/api/v1/prompt-enhancer/cost', {
      model_type: modelType,
    });
  }

  /**
   * Start an enhancement task.
   *
   * `POST /api/v1/prompt-enhancer/enhance/start`
   *
   * Fire-and-poll: returns a `task_id`; call {@link getTask} to read
   * the result. Body is forwarded verbatim — extra keys are accepted
   * via the `[key: string]: …` index signature.
   */
  async start(params: StartPromptEnhancementParams): Promise<StartPromptEnhancementResponse> {
    return this.client.post<StartPromptEnhancementResponse>(
      '/api/v1/prompt-enhancer/enhance/start',
      params,
    );
  }

  /**
   * Poll an in-flight enhancement task.
   *
   * `GET /api/v1/prompt-enhancer/tasks/{id}`
   */
  async getTask(taskId: string): Promise<PromptEnhancementTask> {
    return this.client.get<PromptEnhancementTask>(
      `/api/v1/prompt-enhancer/tasks/${encodeURIComponent(taskId)}`,
    );
  }
}