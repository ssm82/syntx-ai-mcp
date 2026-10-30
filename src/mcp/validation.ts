import Ajv, { type ErrorObject, type ValidateFunction } from 'ajv';
import type { Tool } from './registry';

/**
 * Runtime validation of MCP tool arguments against the tool's declared
 * JSON Schema.
 *
 * The MCP protocol lets a client send any JSON object as `arguments` — the
 * server is the only place that can decide whether those arguments match
 * the schema it advertised in `tools/list`. Without this check every
 * `enum`, every `required` list and every `additionalProperties: false`
 * was advisory only: a client could pass `source: "bogus"` to `list-models`
 * and the handler would silently fall back to a default, or a typo'd
 * argument would be ignored without a word.
 *
 * One validator instance is shared by all tools and compiled schemas are
 * cached per tool name, so the per-call cost is a single `validate()`.
 */

/**
 * `strict: true` keeps ajv honest about schemas it does not understand
 * (an unknown keyword is a compile error, not a silently ignored
 * constraint). Two relaxations are required by the tool schemas:
 *
 * - `strictRequired: false` — `upload-files`, `send-message` and
 *   `delete-file` express "either `path` or `content_base64`" as
 *   `anyOf: [{ required: ['path'] }, { required: ['content_base64'] }]`.
 *   The referenced properties live in the enclosing schema, not in the
 *   branch, which strict mode rejects.
 * - `allowUnionTypes: true` — `send-message` accepts
 *   `type: ['string', 'null']` for an optional attachment field.
 */
const ajv = new Ajv({
  allErrors: true,
  strict: true,
  strictRequired: false,
  allowUnionTypes: true,
  // Never silently repair the caller's arguments: a wrong type is an
  // error the caller can see and correct, not a value we guessed at.
  coerceTypes: false,
  // `default` in a tool schema documents the default; the handlers
  // apply it. Mutating the caller's object here would hide that.
  useDefaults: false,
  removeAdditional: false,
});

const validators = new Map<string, ValidateFunction>();

/**
 * Compile (and cache) the validator for a tool schema.
 *
 * Exported so SDK consumers that invoke a tool handler directly — without
 * going through the MCP server — can enforce the same contract.
 */
export function getToolValidator(name: string, schema: Tool['inputSchema']): ValidateFunction {
  const cached = validators.get(name);
  if (cached) return cached;
  const validate = ajv.compile(schema as object);
  validators.set(name, validate);
  return validate;
}

/** Render an ajv `instancePath` (`/files/0/mime_type`) as `files[0].mime_type`. */
function pathToLabel(instancePath: string): string {
  if (!instancePath) return 'arguments';
  const segments = instancePath.split('/').filter(Boolean);
  let label = '';
  for (const segment of segments) {
    if (/^\d+$/.test(segment)) label += `[${segment}]`;
    else label += label === '' ? segment : `.${segment}`;
  }
  return label;
}

/** Render the offending argument path for a single ajv error. */
function errorLabel(error: ErrorObject): string {
  if (error.keyword === 'required') {
    const missing = String((error.params as { missingProperty?: unknown }).missingProperty ?? '');
    const parent = pathToLabel(error.instancePath);
    return parent === 'arguments' ? missing : `${parent}.${missing}`;
  }
  if (error.keyword === 'additionalProperties') {
    const extra = String(
      (error.params as { additionalProperty?: unknown }).additionalProperty ?? '',
    );
    const parent = pathToLabel(error.instancePath);
    return parent === 'arguments' ? extra : `${parent}.${extra}`;
  }
  return pathToLabel(error.instancePath);
}

/** Human-readable description of what the argument must satisfy. */
function errorRequirement(error: ErrorObject): string {
  const params = error.params as Record<string, unknown>;
  switch (error.keyword) {
    case 'enum': {
      const allowed = (params.allowedValues as unknown[] | undefined) ?? [];
      return `must be one of: ${allowed.map((v) => JSON.stringify(v)).join(', ')}`;
    }
    case 'additionalProperties':
      return 'unexpected property (not allowed by the schema)';
    case 'type': {
      const type = params.type;
      return `must be ${Array.isArray(type) ? type.join(' or ') : String(type)}`;
    }
    case 'required':
      return 'is required';
    case 'minItems':
      return `must have at least ${String(params.limit)} items`;
    case 'maxItems':
      return `must have at most ${String(params.limit)} items`;
    case 'uniqueItems':
      return 'must not contain duplicate items';
    case 'minLength':
      return `must be at least ${String(params.limit)} characters`;
    case 'maxLength':
      return `must be at most ${String(params.limit)} characters`;
    case 'minimum':
      return `must be >= ${String(params.limit)}`;
    case 'maximum':
      return `must be <= ${String(params.limit)}`;
    case 'anyOf':
    case 'oneOf':
    case 'allOf':
      return 'does not match any accepted shape';
    default:
      return 'is invalid';
  }
}

/**
 * Collapse the branch errors ajv emits for `anyOf` / `oneOf` / `allOf`.
 *
 * With `allErrors: true` a failed `anyOf` reports the error of each
 * branch *and* the `anyOf` error itself, which is unreadable noise: the
 * branches are alternatives, so only the group error is meaningful. The
 * branch errors are identified by their schema path, which is a prefix of
 * the group's own schema path — independent of the order ajv emits them in.
 */
function collapseBranchErrors(errors: ErrorObject[]): ErrorObject[] {
  const groupPrefixes = errors
    .filter((error) => error.keyword === 'anyOf' || error.keyword === 'oneOf' || error.keyword === 'allOf')
    .map((error) => `${error.schemaPath}/`);
  return errors.filter(
    (error) => !groupPrefixes.some((prefix) => error.schemaPath.startsWith(prefix)),
  );
}

/**
 * Validate tool arguments against the tool's schema.
 *
 * Returns `ok: true` when the arguments conform. On failure the message
 * lists every violation in a form the calling model can act on — the
 * argument path and what it must satisfy.
 */
export function validateToolArgs(
  name: string,
  schema: Tool['inputSchema'],
  args: unknown,
): { ok: true } | { ok: false; message: string } {
  const validate = getToolValidator(name, schema);
  // A client may omit `arguments` entirely; that is an empty argument
  // object, not an absent value to validate against the schema.
  if (validate(args ?? {})) return { ok: true };

  const errors = collapseBranchErrors(validate.errors ?? []);
  const details = errors.map(
    (error) => `  - "${errorLabel(error)}": ${errorRequirement(error)}`,
  );
  const message = [
    `${name}: invalid arguments:`,
    ...details,
    'See the tool schema for the accepted arguments.',
  ].join('\n');
  return { ok: false, message };
}
