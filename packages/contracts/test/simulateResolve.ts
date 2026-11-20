// Interface fixed by these tests: task `simulate-resolve` (--session, --winners "0,2", --children "0=42,2=invalid";
// child values in the session's unit, 1e18-scaled on chain) and tasks/resolveAnswers.ts (INVALID_ANSWER, encoders).
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

import { expect } from "chai";
import { isHexString, parseEther, toBigInt } from "ethers";
import hre from "hardhat";

type ResolveAnswers = {
  INVALID_ANSWER: string;
  encodeParentAnswer(winners: readonly number[], multiCategorical: boolean): string;
  encodeChildAnswer(value: string): string;
};

const INVALID = (1n << 256n) - 1n;

// Port of Seer RealityProxy.sol payout rules: the oracle these encodings are checked against.
function categoricalPayouts(answer: bigint, numOutcomes: number): bigint[] {
  const payouts: bigint[] = Array.from({ length: numOutcomes + 1 }, () => 0n);
  if (answer === INVALID || answer >= BigInt(numOutcomes)) payouts[numOutcomes] = 1n;
  else payouts[Number(answer)] = 1n;
  return payouts;
}

function multiCategoricalPayouts(answer: bigint, numOutcomes: number): bigint[] {
  const payouts: bigint[] = Array.from({ length: numOutcomes + 1 }, () => 0n);
  if (answer === INVALID) {
    payouts[numOutcomes] = 1n;
    return payouts;
  }
  for (let i = 0; i < numOutcomes; i++) payouts[i] = (answer >> BigInt(i)) & 1n;
  if (!payouts.some((payout) => payout !== 0n)) payouts[numOutcomes] = 1n;
  return payouts;
}

function scalarPayouts(answer: bigint, low: bigint, high: bigint): bigint[] {
  if (answer === INVALID) return [0n, 0n, 1n];
  if (answer <= low) return [1n, 0n, 0n];
  if (answer >= high) return [0n, 1n, 0n];
  return [high - answer, answer - low, 0n];
}

function nonEmptySubsets(numOutcomes: number): number[][] {
  const subsets: number[][] = [];
  for (let mask = 1; mask < 1 << numOutcomes; mask++) {
    subsets.push([...Array(numOutcomes).keys()].filter((i) => (mask >> i) & 1));
  }
  return subsets;
}

function expectedPayouts(winners: readonly number[], numOutcomes: number): bigint[] {
  return [...Array(numOutcomes + 1).keys()].map((i) => (winners.includes(i) ? 1n : 0n));
}

// required at call time so a load failure fails only these tests
function loadResolveAnswers(): Promise<ResolveAnswers> {
  return Promise.resolve(createRequire(__filename)("../tasks/resolveAnswers") as ResolveAnswers);
}

describe("simulate-resolve", function () {
  it("is registered as a hardhat task", function () {
    expect(hre.tasks).to.have.property("simulate-resolve");
  });

  it("is runnable through simulate:resolve:gnosis-fork in contracts and at the root", function () {
    const readScripts = (file: string) =>
      (JSON.parse(readFileSync(file, "utf8")) as { scripts: Record<string, string> }).scripts;
    const contracts = readScripts(path.join(__dirname, "..", "package.json"));
    const root = readScripts(path.join(__dirname, "..", "..", "..", "package.json"));

    expect(contracts["simulate:resolve:gnosis-fork"]).to.match(/hardhat simulate-resolve\b.*--network gnosis-fork/);
    expect(root["simulate:resolve:gnosis-fork"]).to.match(
      /yarn workspace @foresight\/contracts simulate:resolve:gnosis-fork/,
    );
  });
});

describe("Reality answer encoding for simulate-resolve", function () {
  it("encodes INVALID as bytes32 0xff..ff", async function () {
    const { INVALID_ANSWER } = await loadResolveAnswers();
    expect(isHexString(INVALID_ANSWER, 32)).to.equal(true);
    expect(toBigInt(INVALID_ANSWER)).to.equal(INVALID);
  });

  it("pays every chosen winner of a multi-categorical parent and nothing else, for every winner set", async function () {
    const { encodeParentAnswer } = await loadResolveAnswers();
    for (const numOutcomes of [2, 3, 4]) {
      for (const winners of nonEmptySubsets(numOutcomes)) {
        const answer = encodeParentAnswer(winners, true);
        expect(isHexString(answer, 32), `winners ${winners.join(",")}`).to.equal(true);
        expect(multiCategoricalPayouts(toBigInt(answer), numOutcomes), `winners ${winners.join(",")}`).to.deep.equal(
          expectedPayouts(winners, numOutcomes),
        );
      }
    }
  });

  it("pays the chosen winner of a categorical parent and nothing else, for every outcome", async function () {
    const { encodeParentAnswer } = await loadResolveAnswers();
    for (const numOutcomes of [2, 3, 4]) {
      for (let winner = 0; winner < numOutcomes; winner++) {
        const answer = encodeParentAnswer([winner], false);
        expect(isHexString(answer, 32), `winner ${winner}`).to.equal(true);
        expect(categoricalPayouts(toBigInt(answer), numOutcomes), `winner ${winner}`).to.deep.equal(
          expectedPayouts([winner], numOutcomes),
        );
      }
    }
  });

  it("encodes a child value in the session's unit as its 1e18-scaled Reality answer", async function () {
    const { encodeChildAnswer } = await loadResolveAnswers();
    const low = 0n;
    const high = parseEther("100");
    const cases: [string, bigint[]][] = [
      ["0", [1n, 0n, 0n]],
      ["42", [parseEther("58"), parseEther("42"), 0n]],
      ["99.5", [parseEther("0.5"), parseEther("99.5"), 0n]],
      ["0.000000000000000001", [high - 1n, 1n, 0n]],
      ["100", [0n, 1n, 0n]],
    ];
    for (const [value, payouts] of cases) {
      const answer = encodeChildAnswer(value);
      expect(isHexString(answer, 32), value).to.equal(true);
      expect(toBigInt(answer), value).to.equal(parseEther(value));
      expect(scalarPayouts(toBigInt(answer), low, high), value).to.deep.equal(payouts);
    }
  });

  it("encodes an invalid child value as INVALID, which pays only the INVALID outcome", async function () {
    const { encodeChildAnswer, INVALID_ANSWER } = await loadResolveAnswers();
    const answer = encodeChildAnswer("invalid");
    expect(answer.toLowerCase()).to.equal(INVALID_ANSWER.toLowerCase());
    expect(scalarPayouts(toBigInt(answer), 0n, parseEther("100"))).to.deep.equal([0n, 0n, 1n]);
  });
});
