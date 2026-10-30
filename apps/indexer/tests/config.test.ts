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

describe("indexer configs", () => {
  it("has the template and a generated config to check", ({ expect }) => {
    expect(CONFIGS).toContain("config.template.yaml");
    expect(CONFIGS.length).toBeGreaterThan(1);
  });

  it.for(CONFIGS)("selects the transaction's sender for a pool's Swap in %s", (name, { expect }) => {
    const config = readFileSync(path.join(ROOT, name), "utf8");

    expect(eventTransactionFields(config, "Swap")).toEqual(expect.arrayContaining(["hash", "from"]));
  });
});
