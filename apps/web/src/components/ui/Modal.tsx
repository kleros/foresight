import type { ComponentProps } from "react";

import { Modal as LibraryModal } from "@kleros/ui-components-library";
import clsx from "clsx";

/** Stacking: page layers up to z-10, the sticky header z-30, a dialog's overlay z-40. */
const OVERLAY_LAYER = "z-40";

/**
 * The library's modal, its overlay raised over the sticky header so a tall dialog is never covered.
 * `belowHeader` keeps the library's z-20 for a menu that opens from the header and leaves it in view.
 */
export function Modal({
  belowHeader = false,
  modalOverlayClassname,
  shouldCloseOnInteractOutside,
  ...props
}: Omit<ComponentProps<typeof LibraryModal>, "modalOverlayClassname"> & {
  modalOverlayClassname?: string;
  belowHeader?: boolean;
}) {
  return (
    <LibraryModal
      {...props}
      // a tooltip opened inside the dialog is portalled to the body, so a press on it reads as outside
      shouldCloseOnInteractOutside={(element) =>
        !element.closest("[role=tooltip]") && (shouldCloseOnInteractOutside?.(element) ?? true)
      }
      modalOverlayClassname={clsx(!belowHeader && OVERLAY_LAYER, modalOverlayClassname)}
    />
  );
}
