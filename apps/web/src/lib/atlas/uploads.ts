import { type IpfsProduct, Roles, type useAtlasProvider } from "@kleros/kleros-app";

// Atlas accepts these but kleros-app 3.x does not export them; kleros-app passes both through as strings.
export const IPFS_PRODUCT = "Foresight" as IpfsProduct;

export const IMAGE_UPLOAD_ROLE = "foresight-image" as Roles;
export const DOCUMENT_UPLOAD_ROLE = "foresight-metadata" as Roles;

/** Atlas names a role by its enum key, e.g. `ForesightImage`, and uploads take the value. */
export const ROLE_BY_NAME: Record<string, Roles> = {
  ...Roles,
  ForesightImage: IMAGE_UPLOAD_ROLE,
  ForesightMetadata: DOCUMENT_UPLOAD_ROLE,
};

type RoleRestrictions = ReturnType<typeof useAtlasProvider>["roleRestrictions"];

export type UploadRestriction = NonNullable<RoleRestrictions>[number]["restriction"];

export function uploadRestriction(restrictions: RoleRestrictions, role: Roles = IMAGE_UPLOAD_ROLE) {
  return restrictions?.find((entry) => ROLE_BY_NAME[entry.name] === role)?.restriction;
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
