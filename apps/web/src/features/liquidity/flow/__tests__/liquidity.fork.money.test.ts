// @vitest-environment node
import { encodeFunctionData, erc20Abi, parseEther, type Address } from "viem";
import { describe, expect, it } from "vitest";

import { CHAIN_ID, FORK_RPC_URL, LIST, OWNER, RUN_TIMEOUT_MS, STRANGER, hex, useFork } from "./support/fork";
import { userSqrtPrice } from "./support/session";
import { DUST_WEI, GAS_RESERVE_WEI, LIQUIDITY_SLIPPAGE_BPS } from "../../oracle/tolerances";

/**
 * The liquidity flow's amounts on a Gnosis fork, each held to what the user's own inputs imply rather than to what
 * the plan computed (`yarn workspace web test:fork:liquidity`).
 */
const BPS = 10_000n;
const SLIPPAGE = BigInt(LIQUIDITY_SLIPPAGE_BPS);

describe.skipIf(!FORK_RPC_URL)("the liquidity flow's amounts, against a gnosis fork", () => {
  const fork = useFork();

  describe("seeding a new session", () => {
    it(
      "spends each branch's whole budget: the children only rounding, the outcome only what the depths leave",
      async () => {
        await fundSDai(parseEther("50"));
        const depths = [parseEther("20"), parseEther("12")];
        const deepest = depths[0]!;
        const request = await fork.seedRequest({
          total: deepest,
          branches: [
            { depth: depths[0]!, upPriceBps: 6_000n },
            { depth: depths[1]!, upPriceBps: 2_500n },
          ],
        });

        expect(await fork.drive(request, fork.ownerGateway())).toEqual({ stage: "complete" });

        expect(await fork.balanceOf(fork.session.parentInvalid)).toBe(deepest);
        for (const [index, tokens] of fork.session.branches.entries()) {
          const depth = depths[index]!;
          const up = await fork.balanceOf(tokens.upToken);
          const down = await fork.balanceOf(tokens.downToken);
          const outcomeOff = (await fork.balanceOf(tokens.outcome)) - (deepest - depth);
          expect({
            index,
            up: { up, dust: up <= DUST_WEI },
            down: { down, dust: down <= DUST_WEI },
            outcome: { outcomeOff, dust: outcomeOff >= 0n && outcomeOff <= DUST_WEI },
            invalid: await fork.balanceOf(tokens.invalidToken),
          }).toEqual({
            index,
            up: { up, dust: true },
            down: { down, dust: true },
            outcome: { outcomeOff, dust: true },
            invalid: depth / 2n,
          });
        }
      },
      RUN_TIMEOUT_MS,
    );
  });

  describe("pools another account got to first", () => {
    it(
      "caps the realign swap at what the dust position needed plus LIQUIDITY_SLIPPAGE_BPS",
      async () => {
        const tokens = fork.session.branches[0]!;
        const upIsToken0 = BigInt(tokens.upToken) < BigInt(tokens.outcome);
        await fork.createPool(STRANGER, tokens.upToken, tokens.outcome, userSqrtPrice(100n, upIsToken0));
        await fundSDai(parseEther("50"));
        const request = await fork.seedRequest({
          total: parseEther("20"),
          branches: [
            { depth: parseEther("20"), upPriceBps: 6_000n },
            { depth: parseEther("10"), upPriceBps: 5_000n },
          ],
        });
        const gateway = fork.ownerGateway();

        expect(await fork.drive(request, gateway)).toEqual({ stage: "complete" });

        const swapAt = gateway.sent.findIndex((each) => fork.kindOf(each.tx).kind === "swap");
        const swap = fork.kindOf(gateway.sent[swapAt]!.tx);
        if (swap.kind !== "swap") throw new Error("no swap");
        expect(await gateway.reverted(swapAt)).toBe(false);
        const key = swap.tokenIn.toLowerCase();
        const spent = gateway.sent[swapAt]!.before.get(key)! - (await gateway.after(swapAt)).get(key)!;
        // the swap reached its limit price, so it spent the exact need and its fee
        expect(spent).toBeGreaterThan(0n);
        expect(spent).toBeLessThanOrEqual(swap.amountIn);
        expect(swap.amountIn - spent).toBeLessThanOrEqual((swap.amountIn * SLIPPAGE) / BPS);
      },
      RUN_TIMEOUT_MS,
    );

    it(
      "reverts on chain the mint into a live pool moved by twice LIQUIDITY_SLIPPAGE_BPS between review and send",
      async () => {
        const tokens = fork.session.branches[0]!;
        const upIsToken0 = BigInt(tokens.upToken) < BigInt(tokens.outcome);
        await fork.strangerHolds(0, parseEther("40"));
        await fork.createPool(STRANGER, tokens.upToken, tokens.outcome, userSqrtPrice(5_000n, upIsToken0));
        await fork.strangerMints(tokens.upToken, tokens.outcome, parseEther("5"));
        await fundSDai(parseEther("50"));
        const request = await fork.seedRequest({
          total: parseEther("10"),
          branches: [
            { depth: parseEther("10"), upPriceBps: 5_000n },
            { depth: parseEther("4"), upPriceBps: 5_000n },
          ],
        });
        let moved = false;
        // 200 ticks moves the price 2%, which a full-range mint's limited side pulls 2% less of
        const gateway = fork.ownerGateway({
          beforeSend: async (tx) => {
            if (moved || !fork.isSeedMint(tx, tokens.outcome)) return;
            moved = true;
            await fork.strangerMoves(tokens.upToken, tokens.outcome, 200);
          },
        });

        const progress = await fork.drive(request, gateway);

        expect(moved).toBe(true);
        const seedAt = gateway.sent.findIndex((each) => fork.isSeedMint(each.tx, tokens.outcome));
        expect(await gateway.reverted(seedAt)).toBe(true);
        const seeded = (await fork.positionsOf(OWNER)).filter(
          (each) => fork.inPool(each, tokens.upToken, tokens.outcome) && each.liquidity > 0n,
        );
        expect(seeded).toEqual([]);
        expect(progress.stage).not.toBe("complete");
      },
      RUN_TIMEOUT_MS,
    );
  });

  describe("remove and merge", () => {
    it(
      "burns the NFT only for the shown amounts: a pool moved beyond LIQUIDITY_SLIPPAGE_BPS before the send reverts the remove",
      async () => {
        await fork.strangerHolds(0, parseEther("40"));
        await fundSDai(parseEther("50"));
        const seed = await fork.seedRequest({
          total: parseEther("10"),
          branches: [
            { depth: parseEther("10"), upPriceBps: 5_000n },
            { depth: parseEther("6"), upPriceBps: 5_000n },
          ],
        });
        expect(await fork.drive(seed, fork.ownerGateway())).toEqual({ stage: "complete" });
        const tokens = fork.session.branches[0]!;
        const position = (await fork.positionsOf(OWNER)).find((each) =>
          fork.inPool(each, tokens.upToken, tokens.outcome),
        )!;
        const { price } = await fork.poolPrice(position.token0, position.token1);
        const input = {
          chainId: CHAIN_ID,
          owner: OWNER,
          chainTime: await fork.reader.chainTime(),
          sqrtPriceX96: price,
          positions: [position],
        };
        let moved = false;
        // 400 ticks moves the sqrt price 2%, which a withdrawal's token0 falls by
        const gateway = fork.ownerGateway({
          beforeSend: async (tx) => {
            if (moved || !fork.isWithdraw(tx)) return;
            moved = true;
            await fork.strangerMoves(tokens.upToken, tokens.outcome, 400);
          },
        });

        const progress = await fork.drive({ kind: "remove", session: fork.session, input }, gateway);

        expect(moved).toBe(true);
        const removeAt = gateway.sent.findIndex((each) => fork.isWithdraw(each.tx));
        expect(await gateway.reverted(removeAt)).toBe(true);
        expect(await fork.burned(position.tokenId)).toBe(false);
        expect(await fork.reader.ownerOf(position.tokenId)).toBe(OWNER);
        expect(progress.stage).not.toBe("complete");
      },
      RUN_TIMEOUT_MS,
    );

    it(
      "merges a branch's complete sets only as far as its INVALID goes",
      async () => {
        const { session } = fork;
        const tokens = session.branches[0]!;
        await fundSDai(parseEther("50"));
        const parentSplit = parseEther("8");
        const branchSplit = parseEther("3");
        const given = parseEther("1");
        await splitAt(session.parentMarket, session.collateral, parentSplit);
        await splitAt(tokens.childMarket, tokens.outcome, branchSplit);
        await fork.send(
          OWNER,
          tokens.invalidToken,
          encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [STRANGER, given] }),
        );
        const balances = {
          branches: await Promise.all(
            session.branches.map(async (each) => ({
              outcome: await fork.balanceOf(each.outcome),
              up: await fork.balanceOf(each.upToken),
              down: await fork.balanceOf(each.downToken),
              invalid: await fork.balanceOf(each.invalidToken),
            })),
          ),
          parentInvalid: await fork.balanceOf(session.parentInvalid),
        };
        const input = { session, owner: OWNER, balances };
        const plan = fork.app.planMerge(input);
        // branch 0 holds branchSplit of UP and DOWN but only branchSplit - given of INVALID
        expect(plan.branches[0]!.merge).toBe(branchSplit - given);
        const sDaiBefore = await fork.balanceOf(session.collateral);

        expect(await fork.drive({ kind: "merge", input }, fork.ownerGateway())).toEqual({ stage: "complete" });

        expect(await fork.balanceOf(tokens.invalidToken)).toBe(0n);
        expect(await fork.balanceOf(tokens.upToken)).toBe(given);
        expect(await fork.balanceOf(tokens.downToken)).toBe(given);
        // outcome 0 is back to parentSplit - given, so that many parent sets merge
        expect((await fork.balanceOf(session.collateral)) - sDaiBefore).toBe(parentSplit - given);
        expect(await fork.balanceOf(tokens.outcome)).toBe(0n);
        expect(await fork.balanceOf(session.branches[1]!.outcome)).toBe(given);
        expect(await fork.balanceOf(session.parentInvalid)).toBe(given);
      },
      RUN_TIMEOUT_MS,
    );
  });

  describe("seeding from xDAI", () => {
    const branches = (total: bigint) => [
      { depth: total / 2n, upPriceBps: 6_000n },
      { depth: total / 4n, upPriceBps: 4_000n },
    ];

    it(
      "halts before the split when the xDAI would leave GAS_RESERVE_WEI only until the split pays its gas",
      async () => {
        const total = parseEther("10");
        const preview = await fork.previewDeposit(total);
        await fork.rpc("hardhat_setBalance", [OWNER, hex(total + GAS_RESERVE_WEI)]);
        const request = await fork.seedRequest({
          total,
          collateral: "xDAI",
          previewDeposit: preview,
          branches: branches(total),
        });
        const gateway = fork.ownerGateway();

        const progress = await fork.drive(request, gateway);

        expect(progress.stage).toBe("halted");
        expect(progress.failure?.reason).toBe("gas-reserve");
        expect(gateway.sent.filter((each) => (each.tx.value ?? 0n) > 0n)).toEqual([]);
        expect(await fork.nativeOf(OWNER)).toBe(total + GAS_RESERVE_WEI);
      },
      RUN_TIMEOUT_MS,
    );

    it(
      "splits when the wallet keeps GAS_RESERVE_WEI after the split's value and gas",
      async () => {
        const total = parseEther("10");
        const preview = await fork.previewDeposit(total);
        // the node checks each later send's gas limit at its max fee against the balance, so the reserve gets headroom
        await fork.rpc("hardhat_setBalance", [OWNER, hex(total + 5n * GAS_RESERVE_WEI)]);
        const request = await fork.seedRequest({
          total,
          collateral: "xDAI",
          previewDeposit: preview,
          branches: branches(total),
        });
        const gateway = fork.ownerGateway();

        expect(await fork.drive(request, gateway)).toEqual({ stage: "complete" });

        const split = gateway.sent.findIndex((each) => fork.kindOf(each.tx).kind === "splitFromBase");
        expect(gateway.sent[split]!.tx.value).toBe(total);
        expect(await gateway.nativeAfter(split)).toBeGreaterThanOrEqual(GAS_RESERVE_WEI);
      },
      RUN_TIMEOUT_MS,
    );
  });

  describe("seeding through the trade wallet", () => {
    async function tradeWallet() {
      const factory = fork.app.tradeExecutorFactoryAddress(CHAIN_ID)!;
      const state = await fork.app.fetchExecutorState(fork.client(), { factory, owner: OWNER });
      return { address: state.deployed ?? state.predicted, deployed: state.deployed !== null };
    }

    /** What the owner paid in gas for every send of the run, in wei. */
    async function gasPaid(gateway: ReturnType<typeof fork.ownerGateway>) {
      const receipts = await Promise.all(
        gateway.sent.map((each) => fork.client().getTransactionReceipt({ hash: each.hash! })),
      );
      return receipts.reduce((sum, receipt) => sum + receipt.gasUsed * receipt.effectiveGasPrice, 0n);
    }

    /**
     * Every branch's tokens accounted for between the trade wallet and its two pools: each child set's half in its
     * pool bar rounding, the outcome split between the pools at the user's UP price, and nothing in the owner's wallet.
     */
    async function expectLedger(wallet: Address, minted: bigint, branches: { depth: bigint; upPriceBps: bigint }[]) {
      expect(await fork.balanceOf(fork.session.parentInvalid, wallet)).toBe(minted);
      for (const [index, tokens] of fork.session.branches.entries()) {
        const { depth, upPriceBps } = branches[index]!;
        const half = depth / 2n;
        const held = async (token: Address) => ({
          wallet: await fork.balanceOf(token, wallet),
          owner: await fork.balanceOf(token),
        });
        const upPool = await fork.poolAddress(tokens.upToken, tokens.outcome);
        const downPool = await fork.poolAddress(tokens.downToken, tokens.outcome);
        const up = await held(tokens.upToken);
        const down = await held(tokens.downToken);
        const outcome = await held(tokens.outcome);
        const invalid = await held(tokens.invalidToken);
        const pooled = {
          up: await fork.balanceOf(tokens.upToken, upPool),
          down: await fork.balanceOf(tokens.downToken, downPool),
          upOutcome: await fork.balanceOf(tokens.outcome, upPool),
          downOutcome: await fork.balanceOf(tokens.outcome, downPool),
        };
        // UP costs upPriceBps of the outcome, so its pool pairs half × UP price of outcome with half of UP
        // a mint rounds the amounts it pulls up, so either side of the exact figure by a hair
        const near = (actual: bigint, expected: bigint) =>
          (actual > expected ? actual - expected : expected - actual) <= expected / 1_000n;
        expect({
          index,
          owner: [up.owner, down.owner, outcome.owner, invalid.owner],
          invalid: invalid.wallet,
          up: up.wallet + pooled.up === half && up.wallet <= DUST_WEI,
          down: down.wallet + pooled.down === half && down.wallet <= DUST_WEI,
          outcome: outcome.wallet + pooled.upOutcome + pooled.downOutcome === minted - half,
          upOutcome: near(pooled.upOutcome, (half * upPriceBps) / BPS),
          downOutcome: near(pooled.downOutcome, (half * (BPS - upPriceBps)) / BPS),
        }).toEqual({
          index,
          owner: [0n, 0n, 0n, 0n],
          invalid: half,
          up: true,
          down: true,
          outcome: true,
          upOutcome: true,
          downOutcome: true,
        });
      }
      const positions = await fork.positionsOf(wallet);
      expect(positions).toHaveLength(2 * fork.session.branches.length);
      expect(await fork.positionsOf(OWNER)).toHaveLength(0);
    }

    it(
      "takes exactly the sDAI total from the wallet and places it all in the pools and the trade wallet",
      async () => {
        await fundSDai(parseEther("50"));
        const wallet = await tradeWallet();
        const total = parseEther("20");
        const branches = [
          { depth: total, upPriceBps: 6_000n },
          { depth: parseEther("12"), upPriceBps: 2_500n },
        ];
        const sDaiBefore = await fork.balanceOf(fork.session.collateral);
        const nativeBefore = await fork.nativeOf(OWNER);
        const request = await fork.seedRequest({ total, branches, tradeWallet: wallet });
        const gateway = fork.ownerGateway();

        expect(await fork.drive(request, gateway)).toEqual({ stage: "complete" });

        expect(sDaiBefore - (await fork.balanceOf(fork.session.collateral))).toBe(total);
        expect(nativeBefore - (await fork.nativeOf(OWNER))).toBe(await gasPaid(gateway));
        // the deepest branch takes the whole total, so no sDAI is left over
        expect(await fork.balanceOf(fork.session.collateral, wallet.address)).toBe(0n);
        await expectLedger(wallet.address, total, branches);
      },
      RUN_TIMEOUT_MS,
    );

    it(
      "takes exactly the xDAI total plus gas from the wallet, and the trade wallet splits what it deposits",
      async () => {
        const wallet = await tradeWallet();
        const total = parseEther("10");
        const preview = await fork.previewDeposit(total);
        const nativeBefore = await fork.nativeOf(OWNER);
        const request = await fork.seedRequest({
          total,
          collateral: "xDAI",
          previewDeposit: preview,
          branches: [
            { depth: total, upPriceBps: 5_000n },
            { depth: total, upPriceBps: 3_000n },
          ],
          tradeWallet: wallet,
        });
        if (request.kind !== "seed") throw new Error("not a seed");
        const plan = fork.app.planSeed(request.input);
        const gateway = fork.ownerGateway();

        expect(await fork.drive(request, gateway)).toEqual({ stage: "complete" });

        expect(nativeBefore - (await fork.nativeOf(OWNER))).toBe(total + (await gasPaid(gateway)));
        expect(await fork.nativeOf(wallet.address)).toBe(0n);
        const minted = await fork.balanceOf(fork.session.parentInvalid, wallet.address);
        // splitFromBase mints the shares the deposit gets, which interest only raises above the preview
        expect(minted >= preview && minted - preview <= preview / BPS).toBe(true);
        await expectLedger(
          wallet.address,
          minted,
          plan.branches.map((branch) => ({ depth: branch.depth, upPriceBps: branch.upPriceBps })),
        );
      },
      RUN_TIMEOUT_MS,
    );
  });

  const fundSDai = (xdai: bigint) => fork.fundSDai(OWNER, xdai);

  async function splitAt(market: Address, collateral: Address, amount: bigint) {
    await fork.approve(OWNER, collateral, LIST.gnosisRouter, amount);
    await fork.send(
      OWNER,
      LIST.gnosisRouter,
      encodeFunctionData({
        abi: fork.app.gnosisRouterAbi,
        functionName: "splitPosition",
        args: [fork.session.collateral, market, amount],
      }),
    );
  }
});
