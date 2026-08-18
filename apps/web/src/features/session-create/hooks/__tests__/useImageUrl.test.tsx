import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setImageFile } from "../../stores/imageStore";
import { useImageUrl } from "../useImageUrl";

const created: string[] = [];
const revoked: string[] = [];

function Probe() {
  const url = useImageUrl("hero");
  return <div data-testid="url">{url ?? "none"}</div>;
}

const png = (name: string) => new File([new Uint8Array([1, 2, 3])], name, { type: "image/png" });

beforeEach(() => {
  created.length = 0;
  revoked.length = 0;
  let n = 0;
  vi.stubGlobal("URL", {
    ...URL,
    createObjectURL: vi.fn(() => {
      const url = `blob:test/${++n}`;
      created.push(url);
      return url;
    }),
    revokeObjectURL: vi.fn((url: string) => void revoked.push(url)),
  });
  setImageFile("hero", null);
});

afterEach(() => {
  vi.unstubAllGlobals();
  setImageFile("hero", null);
});

describe("useImageUrl", () => {
  it("has nothing to show before a file is picked", () => {
    render(<Probe />);

    expect(screen.getByTestId("url")).toHaveTextContent("none");
  });

  it("produces a url once a file is picked, without a remount", () => {
    render(<Probe />);

    act(() => setImageFile("hero", png("hero.png")));

    expect(screen.getByTestId("url")).toHaveTextContent("blob:test/1");
  });

  it("revokes the old url when the file is replaced", () => {
    render(<Probe />);

    act(() => setImageFile("hero", png("hero.png")));
    act(() => setImageFile("hero", png("hero.png"))); // same name, different File

    expect(created).toEqual(["blob:test/1", "blob:test/2"]);
    expect(revoked).toEqual(["blob:test/1"]);
    expect(screen.getByTestId("url")).toHaveTextContent("blob:test/2");
  });

  it("revokes on unmount", () => {
    const view = render(<Probe />);
    act(() => setImageFile("hero", png("hero.png")));

    view.unmount();

    expect(revoked).toEqual(["blob:test/1"]);
  });
});
