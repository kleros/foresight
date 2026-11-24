import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "..");
/** The template and every config `scripts/update.sh` generated from it. */
const CONFIGS = readdirSync(ROOT).filter((name) => /^config\..+\.yaml$/.test(name));

const indentOf = (line: string) => line.search(/\S/);

/** The `transaction_fields` an event's own `field_selection` lists, read off the YAML by indentation. */
function eventTransactionFields(config: string, signature: string): string[] | null {
  const lines = config.split("\n").filter((line) => line.trim() !== "" && !line.trim().startsWith("#"));
  const at = lines.findIndex((line) => line.trim().startsWith(`- event: ${signature}(`));
  if (at === -1) return null;
  const body = lines.slice(at + 1);
  const end = body.findIndex((line) => indentOf(line) <= indentOf(lines[at]!));
  const block = end === -1 ? body : body.slice(0, end);
  const fields = block.findIndex((line) => line.trim() === "transaction_fields:");
  if (fields === -1) return [];
  const entries = block.slice(fields + 1);
  const stop = entries.findIndex((line) => !line.trim().startsWith("- "));
  return (stop === -1 ? entries : entries.slice(0, stop)).map((line) => line.trim().slice(2).trim());
}

/** The `- event:` line declaring `name` in a config, without its indentation. */
const eventLine = (config: string, name: string) =>
  config
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.startsWith(`- event: ${name}(`));

const TEMPLATE = readFileSync(path.join(ROOT, "config.template.yaml"), "utf8");

/** Each chain's contracts and their `address` entries, read off the `chains:` block by indentation. */
function chainAddresses(config: string): Map<number, Map<string, string[]>> {
  const chains = new Map<number, Map<string, string[]>>();
  const lines = config.split("\n").filter((line) => line.trim() !== "" && !line.trim().startsWith("#"));
  const start = lines.findIndex((line) => line === "chains:");
  let contracts: Map<string, string[]> | undefined;
  let contract: string | undefined;
  let addresses: string[] | undefined;
  for (const line of start === -1 ? [] : lines.slice(start + 1)) {
    const trimmed = line.trim();
    const chainId = /^- id: (\d+)$/.exec(trimmed)?.[1];
    const name = /^- name: (\S+)$/.exec(trimmed)?.[1];
    const address = /^- "?(0x[0-9a-fA-F]{40}|_PLACEHOLDER_)"?$/.exec(trimmed)?.[1];
    if (chainId !== undefined) chains.set(Number(chainId), (contracts = new Map()));
    if (name !== undefined) contract = name;
    if (trimmed === "address:" && contract !== undefined) contracts?.set(contract, (addresses = []));
    else if (address !== undefined && addresses) addresses.push(address);
    else addresses = undefined;
  }
  return chains;
}

/** `scripts/update.sh`'s networks: the generated config and the template chain block it renders. */
const GENERATED = [
  ["config.localhost.yaml", 31337],
  ["config.gnosis.yaml", 100],
  ["config.gnosis-fork.yaml", 100],
] as const;

describe("indexer configs", () => {
  it("has the template and a generated config to check", ({ expect }) => {
    expect(CONFIGS).toContain("config.template.yaml");
    expect(CONFIGS.length).toBeGreaterThan(1);
  });

  it.for(CONFIGS)("selects the transaction's sender for a pool's Swap in %s", (name, { expect }) => {
    const config = readFileSync(path.join(ROOT, name), "utf8");

    expect(eventTransactionFields(config, "Swap")).toEqual(expect.arrayContaining(["hash", "from"]));
  });

  it.for(CONFIGS.flatMap((name) => ["Mint", "Burn"].map((event) => [name, event] as const)))(
    "declares a pool's %s %s exactly as the template does",
    ([name, event], { expect }) => {
      const config = readFileSync(path.join(ROOT, name), "utf8");

      expect(eventLine(TEMPLATE, event)).toBeDefined();
      expect(eventLine(config, event)).toBe(eventLine(TEMPLATE, event));
    },
  );

  it.for(GENERATED)("keeps every address the template spells out in %s", ([name, chainId], { expect }) => {
    const template = chainAddresses(TEMPLATE).get(chainId);
    const generated = chainAddresses(readFileSync(path.join(ROOT, name), "utf8")).get(chainId);
    const external = [...(template ?? [])].filter(([, addresses]) => !addresses.includes("_PLACEHOLDER_"));

    expect(external.map(([contract]) => contract)).toEqual(
      expect.arrayContaining(["AlgebraFactory", "ConditionalTokens"]),
    );
    for (const [contract, addresses] of external) expect(generated?.get(contract), contract).toEqual(addresses);
  });
});
