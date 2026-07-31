import type { CodegenConfig } from "@graphql-codegen/cli";

const subgraphUrl = process.env.NEXT_PUBLIC_SUBGRAPH_URL;

// env manager is not helpful here, so validating ourselves
if (!subgraphUrl) {
  throw new Error("NEXT_PUBLIC_SUBGRAPH_URL is not set");
}

const config: CodegenConfig = {
  overwrite: true,
  schema: subgraphUrl,
  documents: ["src/**/*.{ts,tsx}", "!src/lib/graphql/generated/**"],
  ignoreNoDocuments: true,
  generates: {
    "./src/lib/graphql/generated/": {
      preset: "client",
      config: {
        scalars: {
          numeric: "string",
          bigint: "string",
          timestamptz: "string",
          jsonb: "unknown",
        },
      },
    },
  },
};

export default config;
