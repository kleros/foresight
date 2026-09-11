import type { ReactNode } from "react";

import { Modal } from "@kleros/ui-components-library";
import clsx from "clsx";

import LightButton from "@/components/ui/LightButton";

import CloseIcon from "@/assets/svg/close.svg";

export function WalletDialog({
  isOpen,
  onClose,
  title,
  hint,
  children,
}: {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  hint: string;
  children: ReactNode;
}) {
  return (
    <Modal
      isDismissable
      isOpen={isOpen}
      onOpenChange={onClose}
      className={clsx(
        "relative h-fit w-max max-w-[calc(100vw-2rem)] overflow-x-hidden p-6 py-8",
        "shadow-default rounded-fs border-fs-border bg-fs-surface border",
      )}
    >
      <LightButton
        className="text-fs-text-secondary absolute top-4 right-4 p-1"
        text=""
        aria-label="Close"
        icon={<CloseIcon className="size-4" />}
        onPress={onClose}
      />

      <div className="flex size-full flex-col gap-6">
        <div className="flex w-full flex-col items-center gap-2 text-center">
          <h2 className="text-fs-text-primary text-2xl font-semibold">{title}</h2>
          <p className="text-fs-text-secondary text-sm">{hint}</p>
        </div>
        {children}
      </div>
    </Modal>
  );
}
