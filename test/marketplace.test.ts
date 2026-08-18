import { describe, expect, it } from "vitest";
import { calculateFee, feePercentage, formatLtc } from "../src/marketplace.js";

describe("seller fee policy", () => {
  it("uses the new 10% default and rounds fees to LTC precision", () => {
    expect(feePercentage({} as never)).toBe(10);
    expect(calculateFee(0.00000009, 10)).toBe(0.00000001);
    expect(calculateFee(12.34567891, 10)).toBe(1.23456789);
    expect(formatLtc(11.11111102)).toBe("11.11111102");
  });

  it("uses a valid owner-supplied fee and rejects invalid values", () => {
    expect(feePercentage({ env: { FEE_PERCENTAGE: "10" } } as never)).toBe(10);
    expect(feePercentage({ env: { FEE_PERCENTAGE: "101" } } as never)).toBeUndefined();
  });
});
