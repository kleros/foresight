import * as v from "valibot";

/**
 * Environment manager : parse once at module load,
 * fail loudly with the offending variable names, export a typed `env`.
 *
 * Variables are mapped explicitly instead of looping over `process.env`.
 * Next.js inlines `process.env.NEXT_PUBLIC_*` per literal reference at build
 * time, so an explicit map is the only form guaranteed to survive both the
 * server and the client bundle.
 */
const EnvSchema = v.object({
  REOWN_PROJECT_ID: v.pipe(
    v.string("missing — create a project at https://dashboard.reown.com"),
    v.minLength(1, "must not be empty"),
  ),
  ATLAS_URI: v.pipe(v.string("missing - Kleros Atlas endpoint"), v.url("must be a valid URL")),
  GNOSIS_RPC: v.optional(v.pipe(v.string(), v.url("must be a valid URL"))),
  SITE_URL: v.optional(v.pipe(v.string(), v.url("must be a valid URL"))),
});

const ENV_VAR_NAMES: Record<keyof v.InferOutput<typeof EnvSchema>, string> = {
  REOWN_PROJECT_ID: "NEXT_PUBLIC_REOWN_PROJECT_ID",
  ATLAS_URI: "NEXT_PUBLIC_ATLAS_URI",
  GNOSIS_RPC: "NEXT_PUBLIC_GNOSIS_RPC",
  SITE_URL: "NEXT_PUBLIC_SITE_URL",
};

/** An unset variable and one set to `""` should fail the same way. */
const clean = (value: string | undefined) => (value === "" ? undefined : value);

const parsed = v.safeParse(EnvSchema, {
  REOWN_PROJECT_ID: clean(process.env.NEXT_PUBLIC_REOWN_PROJECT_ID),
  ATLAS_URI: clean(process.env.NEXT_PUBLIC_ATLAS_URI),
  GNOSIS_RPC: clean(process.env.NEXT_PUBLIC_GNOSIS_RPC),
  SITE_URL: clean(process.env.NEXT_PUBLIC_SITE_URL),
});

if (!parsed.success) {
  const nested = v.flatten<typeof EnvSchema>(parsed.issues).nested ?? {};
  const problems = Object.entries(nested)
    .map(([key, messages]) => `  - ${ENV_VAR_NAMES[key as keyof typeof ENV_VAR_NAMES] ?? key}: ${messages?.join(", ")}`)
    .join("\n");

  throw new Error(
    `Invalid environment variables:\n${problems}\n\nSee apps/web/.env.example, then set them in apps/web/.env.local`,
  );
}

export const env = parsed.output;
