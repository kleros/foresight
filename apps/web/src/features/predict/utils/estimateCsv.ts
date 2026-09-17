import type { OptionScale } from "@/types/optionScale";

import { estimateStep, snapEstimate } from "./estimates";

export const CSV_COLUMNS = ["name", "estimate"] as const;

/** RFC 4180 rows: quoted fields may hold commas, newlines and doubled quotes. */
function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += char;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((cells) => cells.some((cell) => cell.trim() !== ""));
}

const quote = (cell: string) => (/[",\r\n]/.test(cell) ? `"${cell.replaceAll('"', '""')}"` : cell);

export function serializeEstimateCsv(rows: { name: string; estimate: number }[]): string {
  return [CSV_COLUMNS.join(","), ...rows.map((row) => `${quote(row.name)},${row.estimate}`)].join("\n");
}

interface ParsedEstimate {
  scale: OptionScale;
  value: number;
}

/**
 * Rows are matched to options by name, and every row must land on an option, inside its scale
 * and on its grid. Throws with the offending row rather than rounding or dropping anything quietly.
 */
export function parseEstimateCsv(text: string, scales: OptionScale[]): ParsedEstimate[] {
  const [header, ...rows] = parseCsvRows(text);
  const columns = header?.map((cell) => cell.trim().toLowerCase()) ?? [];
  const nameAt = columns.indexOf(CSV_COLUMNS[0]);
  const estimateAt = columns.indexOf(CSV_COLUMNS[1]);
  if (columns.length !== 2 || nameAt === -1 || estimateAt === -1) {
    throw new Error(`The first row must name exactly two columns: ${CSV_COLUMNS.join(",")}`);
  }
  if (rows.length === 0) throw new Error("There are no rows under the header.");

  const byName = new Map(scales.map((scale) => [scale.name.trim().toLowerCase(), scale]));
  const parsed = new Map<string, ParsedEstimate>();

  rows.forEach((cells, index) => {
    const line = index + 2;
    const name = (cells[nameAt] ?? "").trim();
    const raw = (cells[estimateAt] ?? "").trim();
    if (!name || !raw) throw new Error(`Row ${line}: both columns need a value.`);

    const scale = byName.get(name.toLowerCase());
    if (!scale) throw new Error(`Row ${line}: there is no option named "${name}".`);

    const value = Number(raw);
    if (!Number.isFinite(value)) throw new Error(`Row ${line}: "${raw}" is not a number.`);
    if (value < scale.lowerBound || value > scale.upperBound) {
      throw new Error(`Row ${line}: ${scale.name} takes ${scale.lowerBound} to ${scale.upperBound}, not ${raw}.`);
    }
    if (snapEstimate(value, scale) !== value) {
      throw new Error(
        `Row ${line}: ${scale.name} moves in steps of ${estimateStep(scale)}, so ${raw} is not a value it can take.`,
      );
    }

    parsed.set(scale.market.toLowerCase(), { scale, value });
  });

  return [...parsed.values()];
}
