import React from "react";

import { cn } from "@/utils/cn";

/** The `.loader` keyframes live in styles/global.css. */
const Loader: React.FC<{ className?: string }> = ({ className }) => <div className={cn("loader", className)} />;

export default Loader;
