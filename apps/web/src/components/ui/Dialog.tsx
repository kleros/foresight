import type { ReactNode } from "react";

import { Modal } from "@kleros/ui-components-library";

import CloseIcon from "@/assets/svg/close.svg";

import { cn } from "@/utils/cn";

import LightButton from "./LightButton";

interface DialogProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  hint: string;
  children: ReactNode;
  className?: string;
  /** False takes away both ways out, for a dialog that must not be left part way through. */
  isDismissable?: boolean;
}

/** A dismissable modal with a centered title and hint, and a close button in the corner. */
export function Dialog({ isOpen, onClose, title, hint, children, className, isDismissable = true }: DialogProps) {
  return (
    <Modal
      isDismissable={isDismissable}
      isOpen={isOpen}
      onOpenChange={(open) => (open || !isDismissable ? undefined : onClose())}
      className={cn(
        "relative h-fit w-max max-w-[calc(100vw-2rem)] overflow-x-hidden p-6 py-8",
        "shadow-default rounded-fs border-fs-border bg-fs-surface border",
        className,
      )}
    >
      {isDismissable ? (
        <LightButton
          className="text-fs-text-secondary absolute top-4 right-4 p-1"
          text=""
          aria-label="Close"
          icon={<CloseIcon className="size-4" />}
          onPress={onClose}
        />
      ) : null}

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
