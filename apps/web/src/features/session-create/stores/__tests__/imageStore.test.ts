import { beforeEach, describe, expect, it, vi } from "vitest";

import { getImageFile, reconcileImageNames, setImageFile, subscribeImages } from "../imageStore";

const file = (name: string) => new File(["bytes"], name, { type: "image/jpeg" });

beforeEach(() => {
  setImageFile("hero", null);
  setImageFile("icon", null);
});

describe("the picked image files", () => {
  it("hands back the file a slot was given", () => {
    const hero = file("hero.jpg");

    setImageFile("hero", hero);

    expect(getImageFile("hero")).toBe(hero);
  });

  it("keeps the slots apart", () => {
    setImageFile("hero", file("hero.jpg"));

    expect(getImageFile("icon")).toBeUndefined();
  });

  it("forgets a slot set to null", () => {
    setImageFile("hero", file("hero.jpg"));

    setImageFile("hero", null);

    expect(getImageFile("hero")).toBeUndefined();
  });

  it("replaces a file with one of the same name", () => {
    setImageFile("hero", file("hero.jpg"));
    const repicked = file("hero.jpg");

    setImageFile("hero", repicked);

    expect(getImageFile("hero")).toBe(repicked);
  });
});

describe("subscribing to the picked files", () => {
  it("notifies on every pick", () => {
    const listener = vi.fn();
    subscribeImages(listener);

    setImageFile("hero", file("hero.jpg"));

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("notifies on a clear", () => {
    const listener = vi.fn();
    subscribeImages(listener);

    setImageFile("hero", null);

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("stops notifying once unsubscribed", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeImages(listener);

    unsubscribe();
    setImageFile("hero", file("hero.jpg"));

    expect(listener).not.toHaveBeenCalled();
  });
});

describe("reconciling drafted names against the files", () => {
  it("reports a name whose bytes are gone", () => {
    expect(reconcileImageNames({ hero: "hero.jpg", icon: null })).toEqual(["hero"]);
  });

  it("reports nothing for a name whose bytes are here", () => {
    setImageFile("hero", file("hero.jpg"));

    expect(reconcileImageNames({ hero: "hero.jpg", icon: null })).toEqual([]);
  });

  it("reports nothing for a slot with no name", () => {
    expect(reconcileImageNames({ hero: null, icon: null })).toEqual([]);
  });

  it("reports both slots when both are gone", () => {
    expect(reconcileImageNames({ hero: "hero.jpg", icon: "icon.png" })).toEqual(["hero", "icon"]);
  });
});
