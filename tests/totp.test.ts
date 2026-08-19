import { describe, expect, it } from "bun:test";
import {
  generateHOTP,
  generateTOTP,
  getPeriodProgress,
  getRemainingSeconds,
  parseOtpAuthUri,
} from "../packages/core/src";

describe("RFC 6238 / RFC 4226 TOTP & URI Test Suite", () => {
  // Standard RFC 4226 Test Secret: "12345678901234567890" in ASCII
  // Base32 representation: GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ
  const RFC_SECRET_BASE32 = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

  it("should generate exact RFC 4226 HOTP test vector values", async () => {
    const expectedHOTPVectors = [
      "755224", // count 0
      "287082", // count 1
      "359152", // count 2
      "969429", // count 3
      "338314", // count 4
      "254676", // count 5
      "287922", // count 6
      "162583", // count 7
      "399871", // count 8
      "520489", // count 9
    ];

    for (let counter = 0; counter < expectedHOTPVectors.length; counter++) {
      const code = await generateHOTP(RFC_SECRET_BASE32, counter, 6, "SHA1");
      expect(code).toBe(expectedHOTPVectors[counter]);
    }
  });

  it("should generate TOTP code at specified timestamps", async () => {
    // Timestamp 59s -> counter 1 (for 30s period)
    const code = await generateTOTP(RFC_SECRET_BASE32, 59 * 1000, 30, 6, "SHA1");
    expect(code).toBe("287082");
  });

  it("should support 8 digit TOTP generation", async () => {
    const code = await generateHOTP(RFC_SECRET_BASE32, 0, 8, "SHA1");
    expect(code.length).toBe(8);
  });

  it("should accurately compute remaining seconds and progress", () => {
    const period = 30;
    const now = 45 * 1000; // 45s -> 15s elapsed, 15s remaining

    const remaining = getRemainingSeconds(period, now);
    expect(remaining).toBe(15);

    const progress = getPeriodProgress(period, now);
    expect(progress).toBe(0.5);
  });

  it("should safely parse standard otpauth URIs", () => {
    const uri = "otpauth://totp/GitHub:user@example.com?secret=JBSWY3DPEHPK3PXP&issuer=GitHub&algorithm=SHA1&digits=6&period=30";
    const parsed = parseOtpAuthUri(uri);

    expect(parsed.issuer).toBe("GitHub");
    expect(parsed.account).toBe("user@example.com");
    expect(parsed.secret).toBe("JBSWY3DPEHPK3PXP");
    expect(parsed.algorithm).toBe("SHA1");
    expect(parsed.digits).toBe(6);
    expect(parsed.period).toBe(30);
  });

  it("should safely sanitize spaces, hyphens and casing in URI secrets", () => {
    const uri = "otpauth://totp/Google:me?secret=jbsw-y3dp-ehpk-3pxp";
    const parsed = parseOtpAuthUri(uri);

    expect(parsed.secret).toBe("JBSWY3DPEHPK3PXP");
    expect(parsed.issuer).toBe("Google");
  });

  it("should reject malicious or invalid schemes in parseOtpAuthUri", () => {
    expect(() => parseOtpAuthUri("javascript:alert(1)")).toThrow();
    expect(() => parseOtpAuthUri("https://evil.com/otpauth")).toThrow();
    expect(() => parseOtpAuthUri("otpauth://totp/Test?missing_secret=1")).toThrow();
  });
});
