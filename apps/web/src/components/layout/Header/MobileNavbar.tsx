"use client";
import { Modal } from "@kleros/ui-components-library";
import clsx from "clsx";
import { useToggle } from "react-use";

import LightButton from "@/components/ui/LightButton";

import HamburgerIcon from "@/assets/menu-icons/hamburger.svg";

import Logo from "./Logo";
import Menu from "./Menu";

const MobileNavbar: React.FC<{ walletSlot?: React.ReactNode }> = ({ walletSlot }) => {
  const [isMenuOpen, toggleIsMenuOpen] = useToggle(false);

  return (
    <>
      <div className="relative flex h-16 w-full items-center justify-between md:hidden!">
        <Logo />
        <LightButton text="" icon={<HamburgerIcon />} onPress={toggleIsMenuOpen} />
      </div>
      <Modal
        className={clsx(
          "mt-16 h-auto max-h-[80vh] w-full overflow-y-auto px-6 py-8",
          "absolute top-0 left-0 flex flex-col gap-6",
          "shadow-default rounded-base border-klerosUIComponentsStroke bg-klerosUIComponentsWhiteBackground border",
          "animate-slide-in-top",
        )}
        isOpen={isMenuOpen}
        onOpenChange={toggleIsMenuOpen}
        isDismissable
      >
        <hr className="border-klerosUIComponentsStroke w-full" />
        <Menu walletSlot={walletSlot} onNavigate={() => toggleIsMenuOpen(false)} />
      </Modal>
    </>
  );
};

export default MobileNavbar;
