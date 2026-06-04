import type { Instance } from "./instances";

// Merging results from both SimOrg instances when a client requests
// `instance=ALL`.
//
// The overlap concern: FR and SA are independent databases, so identifiers
// (e.g. the same numeric _ID) can collide between them. To keep a merged set
// unambiguous, every object we return is tagged with the instance it came
// from under the `_instance` field. Callers can therefore always recover the
// true (instance, id) identity even when ids overlap.

export const INSTANCE_TAG = "_instance";

export interface InstanceResult {
  instance: Instance;
  status: number;
  ok: boolean;
  /** Parsed JSON body, or a string for non-JSON / parse failures. */
  body: unknown;
}

export interface MergeOutcome {
  status: number;
  body: unknown;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Tag a single value with its origin instance (only objects can be tagged). */
function tagValue(value: unknown, instance: Instance): unknown {
  if (isPlainObject(value)) {
    return { ...value, [INSTANCE_TAG]: instance };
  }
  return value;
}

/** Tag every element of an array (or the value itself) with its instance. */
export function tagWithInstance(value: unknown, instance: Instance): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => tagValue(item, instance));
  }
  return tagValue(value, instance);
}

/**
 * Merge per-instance results into a single response.
 *
 * Rules:
 *  - If no instance succeeded, surface 502 with the per-instance errors.
 *  - If every successful body is an array (the common "list" case), return a
 *    single flat array with each element tagged by `_instance`. This mirrors
 *    the shape a single-instance list call would return.
 *  - Otherwise (objects, scalars, mixed shapes), return an object keyed by
 *    instance: { FR: <body>, SA: <body> }, each body tagged where possible.
 *  - Partial success is reported but does not fail the request; failed
 *    instances appear under an `_errors` map.
 */
export function mergeResults(results: InstanceResult[]): MergeOutcome {
  const successes = results.filter((r) => r.ok);
  const failures = results.filter((r) => !r.ok);

  if (successes.length === 0) {
    return {
      status: 502,
      body: {
        error: "All SimOrg instances failed to respond successfully.",
        _errors: Object.fromEntries(
          results.map((r) => [r.instance, { status: r.status, body: r.body }]),
        ),
      },
    };
  }

  const errors =
    failures.length > 0
      ? Object.fromEntries(failures.map((r) => [r.instance, { status: r.status, body: r.body }]))
      : undefined;

  const allArrays = successes.every((r) => Array.isArray(r.body));
  if (allArrays) {
    const merged = successes.flatMap((r) => tagWithInstance(r.body, r.instance) as unknown[]);
    // When everything is a clean array merge, return the bare array unless we
    // need to communicate partial failures.
    if (!errors) {
      return { status: 200, body: merged };
    }
    return { status: 207, body: { data: merged, _errors: errors } };
  }

  const keyed: Record<string, unknown> = {};
  for (const r of successes) {
    keyed[r.instance] = tagWithInstance(r.body, r.instance);
  }
  if (errors) {
    keyed._errors = errors;
  }
  return { status: failures.length > 0 ? 207 : 200, body: keyed };
}
