import { describe, expect, it } from "vitest";
import { isMethodAllowed, requiredScope, isScope } from "../src/lib/scope";

describe("requiredScope", () => {
  it("treats safe methods as READ", () => {
    for (const m of ["GET", "HEAD", "OPTIONS", "get"]) {
      expect(requiredScope(m)).toBe("READ");
    }
  });

  it("treats mutating methods as WRITE", () => {
    for (const m of ["POST", "PUT", "PATCH", "DELETE"]) {
      expect(requiredScope(m)).toBe("WRITE");
    }
  });
});

describe("isMethodAllowed", () => {
  it("lets READ keys perform reads only", () => {
    expect(isMethodAllowed("READ", "GET")).toBe(true);
    expect(isMethodAllowed("READ", "POST")).toBe(false);
    expect(isMethodAllowed("READ", "DELETE")).toBe(false);
  });

  it("lets WRITE keys perform reads and writes", () => {
    expect(isMethodAllowed("WRITE", "GET")).toBe(true);
    expect(isMethodAllowed("WRITE", "POST")).toBe(true);
  });
});

describe("isScope", () => {
  it("validates scope strings", () => {
    expect(isScope("READ")).toBe(true);
    expect(isScope("WRITE")).toBe(true);
    expect(isScope("ADMIN")).toBe(false);
    expect(isScope(null)).toBe(false);
  });
});
