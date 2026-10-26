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
  ...props
}: Omit<ComponentProps<typeof LibraryModal>, "modalOverlayClassname"> & {
  modalOverlayClassname?: string;
  belowHeader?: boolean;
}) {
  return <LibraryModal {...props} modalOverlayClassname={clsx(!belowHeader && OVERLAY_LAYER, modalOverlayClassname)} />;
}
