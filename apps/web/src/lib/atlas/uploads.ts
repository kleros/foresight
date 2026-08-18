import { IpfsProduct, Roles, type useAtlasProvider } from "@kleros/kleros-app";

export const IPFS_PRODUCT = IpfsProduct.Test;
export const UPLOAD_ROLE = Roles.Test;

type RoleRestrictions = ReturnType<typeof useAtlasProvider>["roleRestrictions"];

export type UploadRestriction = NonNullable<RoleRestrictions>[number]["restriction"];

export function uploadRestriction(restrictions: RoleRestrictions, role: Roles = UPLOAD_ROLE) {
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
