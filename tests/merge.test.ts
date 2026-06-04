import { describe, expect, it } from "vitest";
import { mergeResults, tagWithInstance, INSTANCE_TAG, type InstanceResult } from "../src/lib/merge";

describe("tagWithInstance", () => {
  it("tags each element of an array", () => {
    const tagged = tagWithInstance([{ id: 1 }, { id: 2 }], "FR") as Array<Record<string, unknown>>;
    expect(tagged.every((x) => x[INSTANCE_TAG] === "FR")).toBe(true);
  });

  it("tags a single object", () => {
    const tagged = tagWithInstance({ id: 1 }, "SA") as Record<string, unknown>;
    expect(tagged[INSTANCE_TAG]).toBe("SA");
  });

  it("leaves scalars untouched", () => {
    expect(tagWithInstance(42, "FR")).toBe(42);
  });
});

describe("mergeResults", () => {
  const ok = (instance: "FR" | "SA", body: unknown): InstanceResult => ({
    instance,
    status: 200,
    ok: true,
    body,
  });

  it("flattens array responses and tags by instance, preserving id overlap", () => {
    const result = mergeResults([
      ok("FR", [{ _ID: 1, name: "a" }]),
      ok("SA", [{ _ID: 1, name: "b" }]),
    ]);
    expect(result.status).toBe(200);
    const arr = result.body as Array<Record<string, unknown>>;
    expect(arr).toHaveLength(2);
    // Same _ID across instances is disambiguated by _instance.
    expect(arr.find((x) => x[INSTANCE_TAG] === "FR")?.name).toBe("a");
    expect(arr.find((x) => x[INSTANCE_TAG] === "SA")?.name).toBe("b");
  });

  it("keys non-array responses by instance", () => {
    const result = mergeResults([ok("FR", { count: 3 }), ok("SA", { count: 5 })]);
    const body = result.body as Record<string, Record<string, unknown>>;
    expect(body.FR.count).toBe(3);
    expect(body.SA.count).toBe(5);
    expect(body.FR[INSTANCE_TAG]).toBe("FR");
  });

  it("returns 502 when every instance failed", () => {
    const result = mergeResults([
      { instance: "FR", status: 500, ok: false, body: "boom" },
      { instance: "SA", status: 503, ok: false, body: "down" },
    ]);
    expect(result.status).toBe(502);
    expect((result.body as Record<string, unknown>)._errors).toBeDefined();
  });

  it("reports partial failure as 207 with merged data plus _errors", () => {
    const result = mergeResults([
      ok("FR", [{ id: 1 }]),
      { instance: "SA", status: 500, ok: false, body: "boom" },
    ]);
    expect(result.status).toBe(207);
    const body = result.body as { data: unknown[]; _errors: Record<string, unknown> };
    expect(body.data).toHaveLength(1);
    expect(body._errors.SA).toBeDefined();
  });
});
