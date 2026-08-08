import { beforeEach, describe, expect, it, vi } from "vitest";

import { createEmitter, createNotifier } from "../emitter";
import { createFlowScope } from "../scope";
import { doneIds, harness, step } from "./support/harness";

type TestEvent = { type: "a"; value: number } | { type: "b" };

function boom(): never {
  throw new Error("listener blew up");
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("createEmitter", () => {
  it("keeps calling the other handlers when one throws", () => {
    const emitter = createEmitter<TestEvent>();
    const after = vi.fn();
    emitter.on("a", boom);
    emitter.on("a", after);

    emitter.emit({ type: "a", value: 1 });

    expect(after).toHaveBeenCalledWith({ type: "a", value: 1 });
  });

  it("still reaches the wildcard listeners when a typed one throws", () => {
    const emitter = createEmitter<TestEvent>();
    const everything = vi.fn();
    emitter.on("a", boom);
    emitter.on("*", everything);

    emitter.emit({ type: "a", value: 1 });

    expect(everything).toHaveBeenCalledTimes(1);
  });

  it("reports what threw, so a broken listener can be found", () => {
    const emitter = createEmitter<TestEvent>();
    emitter.on("a", boom);

    emitter.emit({ type: "a", value: 1 });

    expect(console.error).toHaveBeenCalledWith(expect.stringContaining(`a "a" handler`), expect.any(Error));
  });

  it("does not let a throwing handler reach the code that emitted", () => {
    const emitter = createEmitter<TestEvent>();
    emitter.on("b", boom);

    expect(() => emitter.emit({ type: "b" })).not.toThrow();
  });
});

describe("createNotifier", () => {
  it("keeps notifying when a listener throws", () => {
    const notifier = createNotifier();
    const after = vi.fn();
    notifier.subscribe(boom);
    notifier.subscribe(after);

    notifier.notify();

    expect(after).toHaveBeenCalledTimes(1);
  });
});

describe("createFlowScope", () => {
  it("keeps notifying when a subscriber throws", () => {
    const scope = createFlowScope();
    const after = vi.fn();
    scope.subscribe(boom);
    scope.subscribe(after);

    scope.freeze("deploy", "run");

    expect(after).toHaveBeenCalledTimes(1);
    expect(scope.isFrozen()).toBe(true);
  });
});

/**
 * An `async` listener rejects after the try block around it has returned, so
 * catching it needs the thenable, not the call. Without this an isolated-looking
 * handler still reaches window.onunhandledrejection and any error reporter.
 */
describe("a listener that rejects rather than throws", () => {
  it("is caught, and never surfaces as an unhandled rejection", async () => {
    const rejections: unknown[] = [];
    const watch = (reason: unknown) => void rejections.push(reason);
    process.on("unhandledRejection", watch);

    const emitter = createEmitter<TestEvent>();
    const after = vi.fn();
    emitter.on("a", async () => boom());
    emitter.on("a", after);

    emitter.emit({ type: "a", value: 1 });

    const notifier = createNotifier();
    notifier.subscribe(async () => boom());
    notifier.notify();

    await new Promise((resolve) => setImmediate(resolve));
    process.off("unhandledRejection", watch);

    expect(after).toHaveBeenCalledOnce();
    expect(rejections).toEqual([]);
  });
});

describe("a run with a broken listener attached", () => {
  it("finishes anyway, because a UI bug is not a reason to strand a transaction", async () => {
    const h = harness();
    h.orchestrator.on("step:submitted", boom);
    h.orchestrator.subscribe(boom);
    h.scope.subscribe(boom);

    await h.start([step("a"), step("b")]);

    expect(h.orchestrator.getStatus()).toBe("completed");
    expect(doneIds(h.orchestrator.getRun())).toEqual(["a", "b"]);
  });
});
