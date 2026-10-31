import { MOCK_ROLES } from "@foresight/mock-atlas";
import { Roles } from "@kleros/kleros-app";
import { describe, it } from "vitest";

import { allowedOf, DOCUMENT_UPLOAD_ROLE, IMAGE_UPLOAD_ROLE, uploadRestriction } from "../uploads";

// `MOCK_ROLES` names roles by their `Roles` key while the constants are the value, and
// nothing type-checks the two against each other.
describe("upload roles", () => {
  it("both resolve through kleros-app's own Roles, the lookup its uploadFile makes", (t) => {
    const byName = Roles as unknown as Record<string, Roles | undefined>;
    const names = MOCK_ROLES.map((entry) => byName[entry.name]);

    t.expect(names).toContain(IMAGE_UPLOAD_ROLE);
    t.expect(names).toContain(DOCUMENT_UPLOAD_ROLE);
  });

  it("sends the metadata document under a role that accepts json, and images under one that does not", (t) => {
    const images = uploadRestriction(MOCK_ROLES, IMAGE_UPLOAD_ROLE);
    const document = uploadRestriction(MOCK_ROLES, DOCUMENT_UPLOAD_ROLE);

    t.expect(document?.allowedMimeTypes).toContain("application/json");
    t.expect(allowedOf(["image/png", "application/json"], images)).toEqual(["image/png"]);
  });
});
