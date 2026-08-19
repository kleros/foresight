import { IpfsProduct, Roles, type useAtlasProvider } from "@kleros/kleros-app";

// TODO: change these once atlas have support for Foresight
export const IPFS_PRODUCT = IpfsProduct.Curate;

export const IMAGE_UPLOAD_ROLE = Roles.CurateItemImage;
export const DOCUMENT_UPLOAD_ROLE = Roles.CurateItemFile;

type RoleRestrictions = ReturnType<typeof useAtlasProvider>["roleRestrictions"];

export type UploadRestriction = NonNullable<RoleRestrictions>[number]["restriction"];

export function uploadRestriction(restrictions: RoleRestrictions, role: Roles = IMAGE_UPLOAD_ROLE) {
  return restrictions?.find((entry) => Roles[entry.name as keyof typeof Roles] === role)?.restriction;
}

export function formatBytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Atlas accepts `image/*` wildcards; `FileUploader` needs concrete types, so
 * what a picker offers is narrowed to what the role actually allows.
 */
export function allowedOf(preferred: string[], restriction: UploadRestriction | undefined): string[] {
  if (!restriction) return preferred;
  return preferred.filter((type) =>
    restriction.allowedMimeTypes.some((allowed) =>
      allowed.endsWith("/*") ? type.startsWith(allowed.slice(0, -1)) : allowed === type,
    ),
  );
}
