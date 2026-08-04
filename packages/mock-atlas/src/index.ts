import type { IAtlasProvider } from "@kleros/kleros-app";

type Role = NonNullable<IAtlasProvider["roleRestrictions"]>[number];

/** Default port; override with MOCK_ATLAS_PORT. */
export const DEFAULT_PORT = 4747;

/** Upload role restrictions, mirroring what the real Atlas serves. */
export const MOCK_ROLES: Role[] = [
  {
    name: "Evidence",
    restriction: {
      maxSize: 20971520,
      allowedMimeTypes: [
        "video/mp4",
        "image/jpeg",
        "image/png",
        "image/jpg",
        "image/bmp",
        "image/gif",
        "image/tiff",
        "image/webp",
        "application/pdf",
        "text/csv",
        "text/html",
        "text/plain",
      ],
    },
  },
  {
    name: "Policy",
    restriction: {
      maxSize: 10485760,
      allowedMimeTypes: ["application/pdf", "text/markdown"],
    },
  },
  {
    name: "Generic",
    restriction: {
      maxSize: 409600,
      allowedMimeTypes: ["video/x-msvideo", "application/pdf", "image/png", "application/json"],
    },
  },
];
