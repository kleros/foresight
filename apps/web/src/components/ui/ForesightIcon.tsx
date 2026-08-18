import type { CSSProperties } from "react";

import clsx from "clsx";

import Challenged from "@/assets/svg/foresight/challenged.svg";
import Chevron from "@/assets/svg/foresight/chevron.svg";
import Indexing from "@/assets/svg/foresight/indexing.svg";
import InfoCircle from "@/assets/svg/foresight/info-circle.svg";
import InfoSquare from "@/assets/svg/foresight/info-square.svg";
import OpeningTime from "@/assets/svg/foresight/opening-time.svg";
import Outcome from "@/assets/svg/foresight/outcome.svg";
import ParentMarket from "@/assets/svg/foresight/parent-market.svg";
import Pending from "@/assets/svg/foresight/pending.svg";
import PhasedDeploy from "@/assets/svg/foresight/phased-deploy.svg";
import Registered from "@/assets/svg/foresight/registered.svg";
import Removed from "@/assets/svg/foresight/removed.svg";
import SessionTree from "@/assets/svg/foresight/session-tree.svg";
import Unlisted from "@/assets/svg/foresight/unlisted.svg";

/**
 * The artwork lives in `assets/svg/foresight/`, on a 24px grid drawn in
 * `currentColor` with no stroke of its own: `.fs-icon svg` supplies the width,
 * the cap and the join, so a file that sets its own would fight the stylesheet.
 * Every stateful icon has two defined endpoints, which is what lets its change
 * be a tween rather than a swap.
 */
const ICONS = {
  // Structure
  "session-tree": SessionTree,
  "parent-market": ParentMarket,
  outcome: Outcome,
  "opening-time": OpeningTime,
  "phased-deploy": PhasedDeploy,
  indexing: Indexing,
  // States
  registered: Registered,
  pending: Pending,
  challenged: Challenged,
  unlisted: Unlisted,
  removed: Removed,
  // Utility
  chevron: Chevron,
  info: InfoSquare,
  "info-circle": InfoCircle,
};

export type ForesightIconName = keyof typeof ICONS;

export type ForesightIconState = "pending" | "drawing" | "expanded";

export function ForesightIcon({
  name,
  size = 24,
  className,
  style,
  state,
}: {
  name: ForesightIconName;
  size?: number;
  className?: string;
  style?: CSSProperties;
  state?: ForesightIconState;
}) {
  const Art = ICONS[name];
  if (!Art) return null;
  return (
    <span className={clsx("fs-icon", className)} style={{ width: size, height: size, ...style }} role="presentation">
      <Art
        className={clsx(state === "pending" && "fs-icon-pending", state === "drawing" && "fs-icon-draw")}
        style={{
          transform: name === "chevron" && state === "expanded" ? "rotate(180deg)" : undefined,
          transition: "transform var(--fs-dur-enter) var(--fs-ease-enter)",
          ["--fs-draw-len" as string]: 40,
        }}
      />
    </span>
  );
}
