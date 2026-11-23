import { describe, expect, it } from "vitest";

import { toWinnerNames } from "../toWinnerNames";

const child = (parentOutcomeIndex: string, parentOutcome: string, displayName: string | null = null) => ({
  parentOutcomeIndex,
  parentOutcome,
  displayName,
});

describe("toWinnerNames", () => {
  it("names each winner as the market page does, display name first, in outcome order", () => {
    const result = {
      Session: [
        {
          outcomes: ["villeneuve", "gerwig", "nolan"],
          children: [child("2", "nolan", "Christopher Nolan"), child("0", "villeneuve")],
        },
      ],
    };

    expect(toWinnerNames(result, [2, 0])).toEqual(["villeneuve", "Christopher Nolan"]);
  });

  it("names a winner with no child market by the parent's outcome name", () => {
    const result = { Session: [{ outcomes: ["villeneuve", "gerwig"], children: [] }] };

    expect(toWinnerNames(result, [1])).toEqual(["gerwig"]);
  });

  it("is undefined where the indexer holds no such session", () => {
    expect(toWinnerNames({ Session: [] }, [0])).toBeUndefined();
  });
});
