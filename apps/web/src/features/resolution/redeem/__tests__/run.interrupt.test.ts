import fc from "fast-check";
import { afterEach, describe, expect, it, vi } from "vitest";

import { callOf, newWorld, OWNER, PLANNED, progress, runs, settled, stored, tab, tick } from "./support/tabs";
import { copyStorage, timesBroadcast } from "./support/world";

afterEach(() => {
  for (const run of runs.splice(0)) run.dispose();
});

const MODES = ["reject", "hang", "unmined"] as const;
type Mode = (typeof MODES)[number];

/** Every (call index, mode, approved after close) a one-by-one run can be interrupted at. */
const EVERY_SEQUENTIAL: [number, Mode, boolean][] = PLANNED.flatMap((_, at) =>
  MODES.flatMap((mode) => [true, false].map((approved): [number, Mode, boolean] => [at, mode, approved])),
);

const EVERY_ATOMIC: [Mode, boolean][] = MODES.flatMap((mode) =>
  [true, false].map((approved): [Mode, boolean] => [mode, approved]),
);

/** Recovers `next`, resumes it from review, and retries it once if it halts, until it rests. */
async function comeBack(next: ReturnType<typeof tab>) {
  next.run.recover();
  await settled(next.run);
  if (progress(next.run).stage === "review") next.run.resume();
  await settled(next.run);
  if (progress(next.run).stage === "halted") next.run.retry();
  await settled(next.run);
}

describe("createRedeemRun interrupted anywhere and reloaded (A3, L8)", () => {
  // every planned call index crossed with every mode, at about 150 ms a run
  it("one by one: broadcasts no call twice, and ends complete or held on a prompt no one answered", async () => {
    let ran = 0;
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 0, max: PLANNED.length - 1 }),
        fc.constantFrom(...MODES),
        fc.boolean(),
        async (at, mode, approvedAfterClose) => {
          ran += 1;
          const world = newWorld();
          const first = tab(world, { script: (index) => (index === at ? mode : "sign") });
          first.run.start();
          if (mode === "hang") await first.sends.held();
          else await vi.waitFor(() => expect(first.sends.prompts.length).toBeGreaterThan(at));
          await tick();
          const left = copyStorage(first.storage);
          first.run.dispose();
          if (mode === "hang" && approvedAfterClose) world.fake.approveLater(first.sends.hung[0]!, OWNER);
          world.fake.land();
          const before = timesBroadcast(world.fake, PLANNED);
          const done = before.indexOf(0) === -1 ? PLANNED.length : before.indexOf(0);

          const next = tab(world, { storage: left });
          await comeBack(next);

          expect(timesBroadcast(world.fake, PLANNED).every((count) => count <= 1)).toBe(true);
          if (mode === "hang" && !approvedAfterClose) {
            expect(progress(next.run).failure).toEqual({ reason: "held", retryable: true });
            expect(next.sends.prompts).toEqual([]);
          } else {
            expect(progress(next.run).stage).toBe("complete");
            expect(next.sends.prompts.map(callOf)).toEqual(PLANNED.slice(done).map(callOf));
            expect(timesBroadcast(world.fake, PLANNED)).toEqual(PLANNED.map(() => 1));
          }
          next.run.dispose();
        },
      ),
      { numRuns: EVERY_SEQUENTIAL.length + 10, examples: EVERY_SEQUENTIAL },
    );
    expect(ran).toBeGreaterThanOrEqual(EVERY_SEQUENTIAL.length);
  }, 60_000);

  it("atomic: lands the batch at most once, and ends complete or halted with no batch sent again", async () => {
    let ran = 0;
    await fc.assert(
      fc.asyncProperty(fc.constantFrom(...MODES), fc.boolean(), async (mode, approvedAfterClose) => {
        ran += 1;
        const world = newWorld();
        const first = tab(world, {
          atomic: true,
          ...(mode === "reject" ? { sendCallsRefuse: 4001 } : {}),
          ...(mode === "unmined" ? { sendCalls: "unmined" as const } : {}),
          ...(mode === "hang"
            ? { answer: (method: string) => (method === "wallet_sendCalls" ? new Promise(() => {}) : undefined) }
            : {}),
        });
        first.run.start();
        await vi.waitFor(() =>
          expect(first.requests.filter((each) => each.method === "wallet_sendCalls")).toHaveLength(1),
        );
        await tick();
        const left = copyStorage(first.storage);
        first.run.dispose();
        const id = stored(left)?.callsId;
        // the wallet landed the batch it never answered for
        if (mode === "hang" && approvedAfterClose)
          world.fake.batches.set(id!, world.fake.approveLater({ to: OWNER, data: "0x" }, OWNER));
        world.fake.land();

        const next = tab(world, { storage: left, atomic: true });
        await comeBack(next);

        const asked = next.requests.filter((each) => each.method === "wallet_sendCalls");
        const landed = world.wallets
          .flatMap((each) => each.sendCalls)
          .filter((call) => world.fake.batches.get(call.id ?? "")?.mined);
        expect(next.sends.prompts).toEqual([]);
        if (mode === "hang" && !approvedAfterClose) {
          expect(progress(next.run).failure).toEqual({ reason: "batch-unknown", retryable: false });
          expect(asked).toEqual([]);
        } else {
          expect(progress(next.run).stage).toBe("complete");
          expect(asked).toHaveLength(mode === "reject" ? 1 : 0);
          expect(landed.length + (mode === "hang" ? 1 : 0)).toBe(1);
        }
        next.run.dispose();
      }),
      { numRuns: EVERY_ATOMIC.length + 4, examples: EVERY_ATOMIC },
    );
    expect(ran).toBeGreaterThanOrEqual(EVERY_ATOMIC.length);
  }, 30_000);
});
