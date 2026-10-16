import React from "react";

import { Tooltip } from "@kleros/ui-components-library";

import HelpIcon from "@/assets/menu-icons/help.svg";

interface IWithHelpTooltip {
  tooltipMsg: string;
  /** The help icon's accessible name. */
  label?: string;
  place?: "bottom" | "left" | "right" | "top";
  children?: React.ReactNode;
  tooltipProps?: Omit<React.ComponentProps<typeof Tooltip>, "text" | "children">;
}

const WithHelpTooltip: React.FC<IWithHelpTooltip> = ({ tooltipMsg, label = "Help", children, place, tooltipProps }) => (
  <div className="flex items-center">
    {children}
    <Tooltip
      small
      text={tooltipMsg}
      {...{ place, tooltipProps }}
      wrapperProps={{ "aria-label": label, className: "shrink-0" }}
      className="max-w-[min(23.5rem,calc(100vw-2rem))] [&>small]:text-sm [&>small]:whitespace-pre-line"
    >
      {/* a 24px box whose ::before reaches the 44px target */}
      <span className="relative ml-1 inline-flex size-6 items-center justify-center before:absolute before:-inset-2.5 before:content-['']">
        <HelpIcon className="size-3 md:size-3.5" />
      </span>
    </Tooltip>
  </div>
);

export default WithHelpTooltip;
