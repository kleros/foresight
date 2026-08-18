import { describe, expect, it } from "vitest";

import { allowedOf, formatBytes } from "../uploads";

describe("allowedOf", () => {
  const restriction = (allowedMimeTypes: string[]) => ({ maxSize: 1, allowedMimeTypes });

  it("drops what a picker offers but the role refuses", () => {
    const offered = ["image/png", "image/jpeg", "image/svg+xml"];

    expect(allowedOf(offered, restriction(["image/png", "image/jpeg"]))).toEqual(["image/png", "image/jpeg"]);
  });

  it("reads a wildcard by prefix, the way Atlas does", () => {
    expect(allowedOf(["image/png", "image/svg+xml"], restriction(["image/*"]))).toEqual(["image/png", "image/svg+xml"]);
  });

  it("offers everything when the role's limits are not known yet", () => {
    expect(allowedOf(["image/png"], undefined)).toEqual(["image/png"]);
  });
});

describe("formatBytes", () => {
  it("counts in MiB, which is what Atlas compares against", () => {
    expect(formatBytes(2_097_152)).toBe("2.0 MB");
  });
});
