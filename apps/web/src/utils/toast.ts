import { toast, type ToastOptions } from "react-toastify";

export const TOAST_OPTIONS: ToastOptions = {
  position: "top-center",
  autoClose: 5000,
  closeOnClick: true,
  pauseOnHover: true,
  draggable: true,
  theme: "colored",
};

export const infoToast = (message: string) => toast.info(message, TOAST_OPTIONS);

export const successToast = (message: string) => toast.success(message, TOAST_OPTIONS);

export const errorToast = (message: string) => toast.error(message, TOAST_OPTIONS);

/**
 * Collapses a burst of identical failures into one toast.
 */
let errorToastTimeout: ReturnType<typeof setTimeout> | undefined;

export const debouncedErrorToast = (message: string, delayMs = 5000) => {
  if (errorToastTimeout) clearTimeout(errorToastTimeout);

  errorToastTimeout = setTimeout(() => errorToast(message), delayMs);
};
