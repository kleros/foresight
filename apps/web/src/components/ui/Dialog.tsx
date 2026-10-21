import type { ReactNode } from "react";

import { Modal } from "@/components/ui/Modal";

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
      ariaLabel={title}
      isDismissable={isDismissable}
      isOpen={isOpen}
      onOpenChange={(open) => (open || !isDismissable ? undefined : onClose())}
      className={cn(
        "relative flex h-fit w-max max-w-[calc(100vw-2rem)] flex-col overflow-hidden",
        // centred, with 4.5rem clear above and below
        "max-h-[calc(100dvh-9rem)]",
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

      {/* the body scrolls, not the dialog, so the close button stays put */}
      <div className="flex min-h-0 w-full flex-col gap-6 overflow-x-hidden overflow-y-auto p-6 py-8">
        <div className="flex w-full flex-col items-center gap-2 text-center">
          <h2 className="text-fs-text-primary text-2xl font-semibold">{title}</h2>
          <p className="text-fs-text-secondary text-sm">{hint}</p>
        </div>
        {children}
      </div>
    </Modal>
  );
}
