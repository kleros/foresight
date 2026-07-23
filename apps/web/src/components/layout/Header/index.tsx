import clsx from "clsx";

import DesktopNavbar from "./DesktopNavbar";
import MobileNavbar from "./MobileNavbar";

const Header: React.FC<{ walletSlot?: React.ReactNode }> = ({ walletSlot }) => {
  return (
    <div className={clsx("bg-klerosUIComponentsWhiteBackground", "wrap sticky top-0 z-30 flex w-full px-6")}>
      <DesktopNavbar walletSlot={walletSlot} />
      <MobileNavbar walletSlot={walletSlot} />
    </div>
  );
};

export default Header;
