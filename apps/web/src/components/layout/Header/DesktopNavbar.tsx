import clsx from "clsx";

import Logo from "./Logo";
import Menu from "./Menu";

const DesktopNavbar: React.FC = () => {
  return (
    <div className={clsx("bg-klerosUIComponentsWhiteBackground", "sticky top-0 z-30 w-full px-6 hidden md:flex")}>
      <div className="flex h-16 w-full items-center justify-between">
        <Logo />
        <Menu />
      </div>
    </div>
  );
};

export default DesktopNavbar;
