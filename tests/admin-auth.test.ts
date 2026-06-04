import { afterEach, describe, expect, it } from "vitest";
import { requireAdmin } from "../src/lib/admin-auth";

function reqWith(headers: Record<string, string>): Request {
  return new Request("http://mw/api/admin/keys", { headers });
}

const original = process.env.ADMIN_TOKEN;
afterEach(() => {
  if (original === undefined) delete process.env.ADMIN_TOKEN;
  else process.env.ADMIN_TOKEN = original;
});

describe("requireAdmin", () => {
  it("is disabled (503) when ADMIN_TOKEN is unset", () => {
    delete process.env.ADMIN_TOKEN;
    const r = requireAdmin(reqWith({}));
    expect(r).toMatchObject({ ok: false, status: 503 });
  });

  it("401 when no token is presented", () => {
    process.env.ADMIN_TOKEN = "s3cret-value";
    expect(requireAdmin(reqWith({}))).toMatchObject({ ok: false, status: 401 });
  });

  it("403 on a wrong token", () => {
    process.env.ADMIN_TOKEN = "s3cret-value";
    expect(requireAdmin(reqWith({ "x-admin-token": "nope" }))).toMatchObject({
      ok: false,
      status: 403,
    });
  });

  it("accepts the correct token via x-admin-token or Bearer", () => {
    process.env.ADMIN_TOKEN = "s3cret-value";
    expect(requireAdmin(reqWith({ "x-admin-token": "s3cret-value" })).ok).toBe(true);
    expect(requireAdmin(reqWith({ authorization: "Bearer s3cret-value" })).ok).toBe(true);
  });
});
