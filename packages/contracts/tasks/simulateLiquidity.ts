import { task, types } from "hardhat/config";
import type { HardhatRuntimeEnvironment } from "hardhat/types";
import type { Contract, Signer } from "ethers";

import { getSeerDeployment } from "../config/seer";

// Swapr's Algebra periphery on Gnosis; its factory() is the AlgebraFactory the indexer follows.
const POSITION_MANAGER_ADDRESS = "0x91fD594c46D8B01E62dBDeBed2401dde01817834";

// Algebra bounds ticks at ±887272; a position's ticks must land on the pool's tick spacing.
const MAX_TICK = 887272;

const ERC20_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function approve(address spender, uint256 value) returns (bool)",
];

const POSITION_MANAGER_ABI = [
  "function factory() view returns (address)",
  "function createAndInitializePoolIfNecessary(address token0, address token1, uint160 sqrtPriceX96) payable returns (address pool)",
  "function mint((address token0, address token1, int24 tickLower, int24 tickUpper, uint256 amount0Desired, uint256 amount1Desired, uint256 amount0Min, uint256 amount1Min, address recipient, uint256 deadline) params) payable returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)",
];

const ALGEBRA_FACTORY_ABI = ["function poolByPair(address tokenA, address tokenB) view returns (address)"];

const POOL_ABI = ["function tickSpacing() view returns (int24)"];

interface SimulateLiquidityArgs {
  session?: number;
  amount: number;
}

// price is token1 per token0; ~1e-16 relative error is fine for a seeded pool.
const sqrtPriceX96 = (price: number): bigint => BigInt(Math.round(Math.sqrt(price) * 2 ** 48)) << 48n;

const fullRangeTick = (spacing: number): number => Math.floor(MAX_TICK / spacing) * spacing;

const approve = async (hre: HardhatRuntimeEnvironment, signer: Signer, token: string, spender: string, value: bigint) =>
  (await new hre.ethers.Contract(token, ERC20_ABI, signer).getFunction("approve")(spender, value)).wait();

const wrappedOutcome = async (market: Contract, index: number): Promise<string> => {
  const [wrapped1155] = (await market.getFunction("wrappedOutcome")(index)) as [string];
  return wrapped1155;
};

interface SeedPoolInput {
  positionManager: Contract;
  algebraFactory: Contract;
  signer: Signer;
  outcomeToken: string;
  underlyingToken: string;
  outcomeAmount: bigint;
  underlyingAmount: bigint;
}

async function seedPool(hre: HardhatRuntimeEnvironment, input: SeedPoolInput): Promise<string> {
  const outcomeIsToken0 = input.outcomeToken.toLowerCase() < input.underlyingToken.toLowerCase();
  const [token0, token1] = outcomeIsToken0
    ? [input.outcomeToken, input.underlyingToken]
    : [input.underlyingToken, input.outcomeToken];

  // seed every outcome token at 0.5 underlying; a rerun on an initialized pool is a no-op
  const price = outcomeIsToken0 ? 0.5 : 2;
  await (
    await input.positionManager.getFunction("createAndInitializePoolIfNecessary")(token0, token1, sqrtPriceX96(price))
  ).wait();

  const poolAddress = (await input.algebraFactory.getFunction("poolByPair")(token0, token1)) as string;
  const pool = new hre.ethers.Contract(poolAddress, POOL_ABI, input.signer);
  const tick = fullRangeTick(Number(await pool.getFunction("tickSpacing")()));

  const [amount0, amount1] = outcomeIsToken0
    ? [input.outcomeAmount, input.underlyingAmount]
    : [input.underlyingAmount, input.outcomeAmount];

  const positionManagerAddress = await input.positionManager.getAddress();
  await approve(hre, input.signer, token0, positionManagerAddress, amount0);
  await approve(hre, input.signer, token1, positionManagerAddress, amount1);

  const latestBlock = await hre.ethers.provider.getBlock("latest");
  if (!latestBlock) {
    throw new Error("Could not read the latest block");
  }

  await (
    await input.positionManager.getFunction("mint")({
      token0,
      token1,
      tickLower: -tick,
      tickUpper: tick,
      amount0Desired: amount0,
      amount1Desired: amount1,
      amount0Min: 0,
      amount1Min: 0,
      recipient: await input.signer.getAddress(),
      deadline: latestBlock.timestamp + 3600,
    })
  ).wait();

  return poolAddress;
}

task("simulate-liquidity", "Seeds Swapr Algebra pools for a session's child markets (needs a gnosis fork)")
  .addOptionalParam("session", "Session id; defaults to the latest", undefined, types.int)
  .addOptionalParam("amount", "Whole xDAI split into parent outcome tokens", 1000, types.int)
  .setAction(async (args: SimulateLiquidityArgs, hre: HardhatRuntimeEnvironment) => {
    const chainId = Number(await hre.getChainId());
    const gnosisRouter = getSeerDeployment(chainId, "GnosisRouter");
    const savingsXDai = getSeerDeployment(chainId, "SavingsXDai");
    const seerMarket = getSeerDeployment(chainId, "Market");
    if (!gnosisRouter || !savingsXDai || !seerMarket) {
      throw new Error(
        `No Seer GnosisRouter/SavingsXDai/Market deployment for chain ${chainId} - ` +
          "this task needs real Seer contracts, run against a gnosis fork (yarn local-stack gnosis-fork).",
      );
    }

    const [signer] = await hre.ethers.getSigners();
    if (!signer) {
      throw new Error("No signer available on this network");
    }

    const deployment = await hre.deployments.get("SessionFactory").catch(() => {
      throw new Error(`SessionFactory is not deployed on network '${hre.network.name}'.`);
    });
    const sessionFactory = await hre.ethers.getContractAt("SessionFactory", deployment.address);

    const sessionCount = await sessionFactory.sessionCount();
    if (sessionCount === 0n) {
      throw new Error("No sessions deployed yet - run simulate-session first");
    }
    const sessionId = args.session ?? Number(sessionCount - 1n);
    const session = await sessionFactory.getSession(sessionId);
    if (session.childMarkets.length === 0) {
      throw new Error(`Session #${sessionId} has no child markets yet`);
    }

    const router = new hre.ethers.Contract(gnosisRouter.address, gnosisRouter.abi, signer);
    const positionManager = new hre.ethers.Contract(POSITION_MANAGER_ADDRESS, POSITION_MANAGER_ABI, signer);
    const algebraFactory = new hre.ethers.Contract(
      (await positionManager.getFunction("factory")()) as string,
      ALGEBRA_FACTORY_ABI,
      signer,
    );
    const parentMarket = new hre.ethers.Contract(session.parentMarket, seerMarket.abi, signer);

    console.log(`Splitting ${args.amount} xDAI into outcome tokens of parent ${session.parentMarket}…`);
    await (
      await router.getFunction("splitFromBase")(session.parentMarket, {
        value: hre.ethers.parseEther(String(args.amount)),
      })
    ).wait();

    console.log(`\nSession #${sessionId}`);
    for (const [index, childAddress] of session.childMarkets.entries()) {
      const underlyingAddress = await wrappedOutcome(parentMarket, index);
      const underlying = new hre.ethers.Contract(underlyingAddress, ERC20_ABI, signer);

      // half the branch budget becomes child outcome tokens, the rest pairs them in two pools
      const balance = (await underlying.getFunction("balanceOf")(await signer.getAddress())) as bigint;
      const splitAmount = balance / 2n;
      if (splitAmount === 0n) {
        throw new Error(`No balance of parent outcome token ${underlyingAddress} to split`);
      }

      await approve(hre, signer, underlyingAddress, gnosisRouter.address, splitAmount);
      await (await router.getFunction("splitPosition")(savingsXDai.address, childAddress, splitAmount)).wait();

      const child = new hre.ethers.Contract(childAddress, seerMarket.abi, signer);
      const downToken = await wrappedOutcome(child, 0);
      const upToken = await wrappedOutcome(child, 1);

      console.log(`  child ${index}  ${childAddress}`);
      for (const outcomeToken of [downToken, upToken]) {
        const pool = await seedPool(hre, {
          positionManager,
          algebraFactory,
          signer,
          outcomeToken,
          underlyingToken: underlyingAddress,
          outcomeAmount: splitAmount,
          underlyingAmount: balance / 4n,
        });
        console.log(`    pool ${pool}  ${outcomeToken} / ${underlyingAddress}`);
      }
    }
  });
