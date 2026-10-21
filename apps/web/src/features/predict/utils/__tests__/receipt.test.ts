import type { Hash } from "viem";
import { describe, expect, it } from "vitest";

import { STEP_ID } from "../../flow/stepIds";
import { receiptRows } from "../receipt";

const WALLET = "0xdcee0000000000000000000000000000000c664f" as const;
const WAD = 10n ** 18n;
const hash = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as Hash;
const txUrl = (tx: Hash) => `https://gnosisscan.io/tx/${tx}`;
const SDAI = { symbol: "sDAI", decimals: 18 };

describe("receiptRows", () => {
  it("says each step of a first run in past tense with its figure and its own transaction", () => {
    const rows = receiptRows({
      steps: [
        { id: STEP_ID.createExecutor, hash: hash(1) },
        { id: STEP_ID.deposit, hash: hash(2) },
        { id: STEP_ID.predict(1), hash: hash(3) },
      ],
      funds: { toAdd: 10n * WAD, ...SDAI },
      wallet: WALLET,
      txUrl,
    });

    expect(rows).toEqual([
      {
        id: STEP_ID.createExecutor,
        title: "Trade wallet created",
        detail: "0xdcee...664f",
        links: [{ href: txUrl(hash(1)), hash: hash(1), label: "Trade wallet transaction" }],
      },
      {
        id: STEP_ID.deposit,
        title: "Funds added",
        detail: "10 sDAI",
        links: [{ href: txUrl(hash(2)), hash: hash(2), label: "Funds transaction" }],
      },
      {
        id: "predict",
        title: "Prediction placed",
        links: [{ href: txUrl(hash(3)), hash: hash(3), label: "Prediction transaction" }],
      },
    ]);
  });

  it("leaves out the wallet row where the wallet already existed", () => {
    const rows = receiptRows({
      steps: [{ id: STEP_ID.createExecutor }, { id: STEP_ID.deposit, hash: hash(2) }, { id: STEP_ID.predict(1) }],
      funds: { toAdd: 10n * WAD, ...SDAI },
      wallet: WALLET,
      txUrl,
    });

    expect(rows.map((row) => row.title)).toEqual(["Funds added", "Prediction placed"]);
  });

  it("keeps a funds step that landed without a hash, unlinked", () => {
    const rows = receiptRows({
      steps: [{ id: STEP_ID.deposit }, { id: STEP_ID.predict(1), hash: hash(3) }],
      funds: { toAdd: 4n * WAD, symbol: "xDAI", decimals: 18 },
      txUrl,
    });

    expect(rows[0]).toEqual({ id: STEP_ID.deposit, title: "Funds added", detail: "4 xDAI", links: [] });
  });

  it("gives the credits moved from the wallet a row and a link of their own, before the funds", () => {
    const rows = receiptRows({
      steps: [
        { id: STEP_ID.createExecutor },
        { id: STEP_ID.addCredits, hash: hash(6) },
        { id: STEP_ID.deposit, hash: hash(2) },
        { id: STEP_ID.predict(1), hash: hash(3) },
      ],
      funds: { toAdd: 8n * WAD, ...SDAI, credits: 2n * WAD },
      txUrl,
    });

    expect(rows.slice(0, 2)).toEqual([
      {
        id: STEP_ID.addCredits,
        title: "Credits added",
        detail: "2 credits",
        links: [{ href: txUrl(hash(6)), hash: hash(6), label: "Credits transaction" }],
      },
      {
        id: STEP_ID.deposit,
        title: "Funds added",
        detail: "8 sDAI",
        links: [{ href: txUrl(hash(2)), hash: hash(2), label: "Funds transaction" }],
      },
    ]);
  });

  it("numbers the batches as links on the one prediction row, skipping one that has no hash", () => {
    const rows = receiptRows({
      steps: [
        { id: STEP_ID.predict(1) },
        { id: STEP_ID.predict(2), hash: hash(4) },
        { id: STEP_ID.predict(3), hash: hash(5) },
      ],
      txUrl,
    });

    expect(rows).toEqual([
      {
        id: "predict",
        title: "Prediction placed",
        links: [
          { href: txUrl(hash(4)), hash: hash(4), label: "Prediction transaction 2 of 3", text: "2" },
          { href: txUrl(hash(5)), hash: hash(5), label: "Prediction transaction 3 of 3", text: "3" },
        ],
      },
    ]);
  });

  it("links nothing on a chain with no explorer", () => {
    const rows = receiptRows({
      steps: [
        { id: STEP_ID.createExecutor, hash: hash(1) },
        { id: STEP_ID.deposit, hash: hash(2) },
        { id: STEP_ID.predict(1), hash: hash(3) },
      ],
      funds: { toAdd: 10n * WAD, ...SDAI },
      txUrl: () => undefined,
    });

    expect(rows.map((row) => row.title)).toEqual(["Trade wallet created", "Funds added", "Prediction placed"]);
    expect(rows.flatMap((row) => row.links)).toEqual([]);
  });

  it("says no figure for funds where nothing was added", () => {
    const rows = receiptRows({
      steps: [{ id: STEP_ID.deposit, hash: hash(2) }],
      funds: { toAdd: 0n, ...SDAI },
      txUrl,
    });

    expect(rows[0]).not.toHaveProperty("detail");
  });
});
