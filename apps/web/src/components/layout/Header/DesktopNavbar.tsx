import clsx from "clsx";

import Logo from "./Logo";
import Menu from "./Menu";

const DesktopNavbar: React.FC<{ walletSlot?: React.ReactNode }> = ({ walletSlot }) => {
  return (
    <div className={clsx("bg-klerosUIComponentsWhiteBackground", "sticky top-0 z-30 w-full px-6 hidden md:flex")}>
      <div className="flex h-16 w-full items-center justify-between">
        <Logo />
        <Menu walletSlot={walletSlot} />
      </div>
    </div>
  );
};

export default DesktopNavbar;
