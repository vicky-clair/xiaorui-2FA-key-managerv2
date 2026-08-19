import { describe, expect, it } from "bun:test";
import { EntitlementService, FreeLimitReachedError } from "../packages/core/src";

describe("Entitlement & Feature Gate Test Suite", () => {
  it("should enforce 10 accounts limit on Free plan", () => {
    const service = new EntitlementService("free");

    expect(service.getPlan()).toBe("free");
    expect(service.canAddEntry(0)).toBe(true);
    expect(service.canAddEntry(9)).toBe(true);
    expect(service.canAddEntry(10)).toBe(false);
    expect(service.canAddEntry(15)).toBe(false);

    expect(() => service.assertCanAddEntry(10)).toThrow(FreeLimitReachedError);
  });

  it("should allow unlimited accounts on Pro plan", () => {
    const service = new EntitlementService("pro");

    expect(service.getPlan()).toBe("pro");
    expect(service.canAddEntry(10)).toBe(true);
    expect(service.canAddEntry(1000)).toBe(true);
    expect(() => service.assertCanAddEntry(1000)).not.toThrow();
  });
});
