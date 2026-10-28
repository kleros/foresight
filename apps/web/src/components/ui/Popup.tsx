import clsx from "clsx";

import LightButton from "@/components/ui/LightButton";

import CloseIcon from "@/assets/svg/close.svg";

/** The house popup's box: under the header, centred, at most 480px wide, its body bounded by the window. */
export const POPUP_FRAME = clsx(
  "fixed top-18 left-1/2 -translate-x-1/2 transform",
  "h-auto max-h-[calc(100dvh-5rem)] md:max-h-[calc(100dvh-5.5rem)]",
  "w-[calc(100vw-2rem)] max-w-[480px]",
  "flex px-4 pt-4 pb-0! md:px-5 md:pt-5",
  "fs-aurora rounded-fs-popup bg-fs-surface border border-(--fs-popup-edge) shadow-(--fs-popup-shadow)",
);

/** The popup's round close button, with a 44px target. */
export function PopupCloseButton({
  label = "Close",
  isDisabled,
  onPress,
}: {
  label?: string;
  isDisabled: boolean;
  onPress: () => void;
}) {
  return (
    <LightButton
      text=""
      aria-label={label}
      icon={<CloseIcon className="text-fs-popup-text-2 size-4.5" />}
      isDisabled={isDisabled}
      onPress={onPress}
      className={clsx(
        "relative -mr-1.5 size-8 justify-center rounded-full! p-0",
        "hover:bg-transparent [@media(hover:hover)]:hover:bg-fs-popup-hover disabled:opacity-40",
        "before:absolute before:-inset-1.5 before:content-['']",
        // the scroller's top edge is the button's, so its ring sits inside
        "landscape-phone:[--fs-focus-offset:-2px]",
      )}
    />
  );
}
