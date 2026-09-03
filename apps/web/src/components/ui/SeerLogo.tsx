import clsx from "clsx";

import SeerLogoDark from "@/assets/svg/seer-logo-dark.svg";
import SeerLogoLight from "@/assets/svg/seer-logo-light.svg";

export function SeerLogo({ className }: { className?: string }) {
  return (
    <span className={clsx("inline-block", className)}>
      <SeerLogoLight className="dark:hidden" aria-hidden />
      <SeerLogoDark className="hidden dark:block" aria-hidden />
    </span>
  );
}
