import { describe, expect, it, vi } from "vitest";

import { createFlowScope } from "../scope";

/**
 * While a run is active, anything that refetches on its own must hold still
 * rather than re-render numbers underneath someone who is mid-signature. The
 * scope is the flag they gate on.
 */
describe("createFlowScope", () => {
  it("starts unfrozen, so nothing is blocked before a flow begins", () => {
    expect(createFlowScope().isFrozen()).toBe(false);
  });

  it("freezes with a reason a consumer can show", () => {
    const scope = createFlowScope();

    scope.freeze("deploy", "Deploying session");

    expect(scope.isFrozen()).toBe(true);
    expect(scope.reason()).toBe("Deploying session");
  });

  it("says nothing when the same owner freezes again for the same reason", () => {
    const scope = createFlowScope();
    const listener = vi.fn();
    scope.subscribe(listener);

    scope.freeze("deploy", "Deploying session");
    scope.freeze("deploy", "Deploying session");

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("announces a changed reason, which is what a banner renders", () => {
    const scope = createFlowScope();
    const listener = vi.fn();
    scope.subscribe(listener);

    scope.freeze("deploy", "Deploying session");
    scope.freeze("deploy", "Confirming batch 2");

    expect(scope.reason()).toBe("Confirming batch 2");
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("stays frozen while any other owner still holds it", () => {
    const scope = createFlowScope();

    scope.freeze("deposit", "Depositing");
    scope.freeze("deploy", "Deploying session");
    scope.unfreeze("deploy");

    // The deposit is still signing. A plain boolean would have unlocked here.
    expect(scope.isFrozen()).toBe(true);
    expect(scope.reason()).toBe("Depositing");

    scope.unfreeze("deposit");
    expect(scope.isFrozen()).toBe(false);
    expect(scope.reason()).toBeNull();
  });

  it("ignores an unfreeze from an owner that never froze", () => {
    const scope = createFlowScope();
    const listener = vi.fn();
    scope.subscribe(listener);

    scope.freeze("deploy", "Deploying session");
    scope.unfreeze("someone-else");

    expect(scope.isFrozen()).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("stops notifying once unsubscribed", () => {
    const scope = createFlowScope();
    const listener = vi.fn();

    const unsubscribe = scope.subscribe(listener);
    unsubscribe();

    scope.freeze("deploy", "run");

    expect(listener).not.toHaveBeenCalled();
  });
});
