import clsx from "clsx";

import DesktopNavbar from "./DesktopNavbar";
import MobileNavbar from "./MobileNavbar";

const Header: React.FC<{ walletSlot?: React.ReactNode }> = ({ walletSlot }) => {
  return (
    <header className={clsx("bg-klerosUIComponentsWhiteBackground", "sticky top-0 z-30 flex w-full")}>
      <DesktopNavbar walletSlot={walletSlot} />
      <MobileNavbar walletSlot={walletSlot} />
    </header>
  );
};

export default Header;
