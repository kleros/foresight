import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/**
 * A picked image, full size. Grows out of the thumbnail it was opened from;
 * Escape or a click outside the image closes it.
 */
export function ImageLightbox({
  src,
  alt,
  from,
  onClose,
}: {
  src: string;
  alt: string;
  /** The viewport rect of the thumbnail, which is where the growth starts. */
  from: { left: number; top: number; width: number; height: number };
  onClose: () => void;
}) {
  const [entered, setEntered] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  // The first frame paints the collapsed state, or there is nothing to transition from.
  useEffect(() => {
    const frame = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => void (document.body.style.overflow = previous);
  }, []);

  // aria-modal hides the rest of the page from assistive tech, so focus has to
  // come in here and go back where it was.
  useEffect(() => {
    const opener = document.activeElement;
    dialogRef.current?.focus();
    return () => void (opener instanceof HTMLElement && opener.focus());
  }, []);

  return createPortal(
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={alt}
      tabIndex={-1}
      onClick={onClose}
      onKeyDown={(event) => event.key === "Tab" && event.preventDefault()}
      className="fixed inset-0 z-50 cursor-zoom-out bg-black/70 outline-none [transition:opacity_var(--fs-dur-enter)_var(--fs-ease-enter)]"
      style={{ opacity: entered ? 1 : 0 }}
    >
      <div
        className="fixed inset-0 flex items-center justify-center p-10 [transition:transform_var(--fs-dur-enter)_var(--fs-ease-enter)]"
        style={{
          transformOrigin: `${from.left + from.width / 2}px ${from.top + from.height / 2}px`,
          transform: entered ? "none" : "scale(0.08)",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- a local blob preview, which next/image cannot load */}
        <img
          src={src}
          alt={alt}
          onClick={(event) => event.stopPropagation()}
          className="rounded-fs max-h-full max-w-full object-contain"
        />
      </div>
    </div>,
    document.body,
  );
}
