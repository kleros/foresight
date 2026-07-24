import React from "react";

import InfoCircle from "@/assets/svg/info.svg";

import { cn } from "@/utils/cn";

const InfoCard: React.FC<{ msg: string; className?: string }> = ({ msg, className }) => (
  <div
    className={cn(
      "grid grid-cols-[16px_auto] items-center justify-start gap-2",
      "text-klerosUIComponentsSecondaryText text-start",
      className,
    )}
  >
    <InfoCircle />
    {msg}
  </div>
);

export default InfoCard;
