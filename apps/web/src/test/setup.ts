import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Auto-cleanup only ships with `globals: true`; unmount between tests ourselves.
afterEach(cleanup);

// jsdom implements no ResizeObserver, and the Kleros components that measure
// themselves throw on mount without one.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
