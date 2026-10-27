import { useEffect, useLayoutEffect, useRef, useState, type ComponentProps } from "react";

import { FileUploader, TextArea, TextField, Tooltip } from "@kleros/ui-components-library";
import clsx from "clsx";

import { ForesightIcon } from "@/components/ui/ForesightIcon";

import TrashIcon from "@/assets/svg/trash.svg";

import { isLegibleBranchColor } from "@/utils/branchColor";

import { allowedOf, formatBytes, type UploadRestriction } from "@/lib/atlas/uploads";

import { AdvancedToggle, FieldLabel, hintTooltipClass, InfoTip } from "./fields";
import { ImageLightbox } from "./ImageLightbox";
import { MarkdownField } from "./MarkdownField";
import { SectionHeader } from "./SectionHeader";
import { MAX_IMAGE_BLOCKS } from "../flow/metadata";
import { useImageUrl } from "../hooks/useImageUrl";
import { useTouched } from "../hooks/useTouched";
import { useDraftStore } from "../stores/draftStore";
import { getImageFile, imageSlot, setImageFile } from "../stores/imageStore";
import type { DraftAssessment, OutcomeImageDraft } from "../types/draft";

const MARKDOWN_INPUT = "w-full text-sm";

const UPLOADER = "w-full [&_small]:text-sm";

/** The library names every drop zone "DropZone" plus the first `#dropzone-label` on the page, and re-ids it after mount. */
function NamedFileUploader({ label, ...props }: ComponentProps<typeof FileUploader> & { label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  // The extra render after mount lands after the library's own re-id.
  const [settled, setSettled] = useState(false);
  useEffect(() => setSettled(true), []);
  useLayoutEffect(() => {
    // The library renders a visually hidden drop-zone button before the visible one.
    const [dropZone, trigger] = ref.current?.querySelectorAll("button") ?? [];
    dropZone?.setAttribute("aria-label", "Paste or drop a file");
    dropZone?.removeAttribute("aria-labelledby");
    trigger?.setAttribute("aria-label", label);
  }, [label, settled]);
  return (
    <div ref={ref} className="contents">
      <FileUploader {...props} />
    </div>
  );
}

/** What this step offers, before the role's own allow-list narrows it. */
const HERO_TYPES = ["image/png", "image/jpeg"];
const ICON_TYPES = [...HERO_TYPES, "image/svg+xml"];

/** Which uploader a size error belongs to: hero, icon, or a branch's outcome id. */
type UploaderKey = string;

/**
 * Step 3: the IPFS metadata document. Permanent once deployed: its hash goes
 * into the deploy transaction and there is no edit path, ever.
 *
 * Images are held locally and uploaded as the first stage of deploy, so the
 * whole wizard stays fillable while disconnected.
 */
export function DisplayMetadataStep({
  assessment,
  active,
  restriction,
}: {
  assessment: DraftAssessment;
  active: boolean;
  restriction?: UploadRestriction;
}) {
  const { draft, setDraftField, patchOutcome, addImage, patchImage, removeImage } = useDraftStore();
  const [advanced, setAdvanced] = useState(true);

  const [tooBig, setTooBig] = useState<Record<UploaderKey, string | null>>({});

  const maxSize = restriction?.maxSize;
  const limitCopy = maxSize ? `, up to ${formatBytes(maxSize)}` : "";

  /**
   * Atlas rejects an oversized file itself, at the start of the deploy. Catching
   * it here only moves that failure to the step that can still fix it.
   */
  const withinLimit = (file: File | undefined, uploader: UploaderKey) => {
    const over = !!file && !!maxSize && file.size > maxSize;
    setTooBig((current) => ({
      ...current,
      [uploader]:
        over && maxSize ? `${file.name} is ${formatBytes(file.size)}. The limit is ${formatBytes(maxSize)}.` : null,
    }));
    return !!file && !over;
  };

  const pick = (slot: "hero" | "icon", field: "heroImageName" | "iconName", file: File) => {
    setImageFile(slot, file);
    setDraftField(field, file.name);
  };

  const addGalleryImage = (outcomeId: string, file: File) => {
    const id = crypto.randomUUID();
    // The draft entry first: bytes stored for an entry the cap refused would leak.
    if (addImage(outcomeId, { id, title: "", fileName: file.name })) setImageFile(imageSlot(id), file);
  };

  const cardComplete = !!draft.description.trim() && !!draft.heroImageName && !!draft.iconName;
  const { touched, touch } = useTouched();
  const titleFlagged = !draft.title.trim() && (!!draft.title || touched("title"));

  return (
    <section
      id="sec3"
      data-screen-label="Step 3: Display metadata"
      className="border-fs-border border-b py-20 max-[1040px]:scroll-mt-16"
    >
      <SectionHeader
        step={3}
        kicker="Display metadata"
        title="How should it read to everyone else?"
        lede="The title, images and colours everyone else will see. These are locked in when you deploy."
        ok={assessment.steps.display}
        active={active}
      />

      <div className="fs-grad-border bg-fs-surface relative z-3 mb-7 flex flex-wrap items-center gap-3 px-4 py-3">
        <ForesightIcon name="check" size={18} className="text-fs-accent-protocol" />
        <span className="text-fs-text-primary text-sm font-semibold">Permanent once deployed</span>
        <InfoTip
          place="bottom"
          text="Once you deploy, nobody can rename or recolour a branch, including you. That is what stops a session being changed after people have started trading. Everything here stays editable until then."
        />
      </div>

      <div className="fs-card flex flex-col gap-7 px-8 py-7">
        <TextField
          className="w-full"
          label="Session title"
          value={draft.title}
          onChange={(v) => setDraftField("title", v)}
          onBlur={() => touch("title")}
          placeholder="A short name for this session"
          variant={titleFlagged ? "warning" : undefined}
          message={titleFlagged ? "Required. The card has nothing to be called." : undefined}
        />

        <div>
          <div className="type-label text-fs-text-secondary pb-2.5">Branch colours</div>
          <div className="flex flex-col gap-2">
            {draft.outcomes.map((o, i) => (
              <div key={o.id} className="grid grid-cols-[minmax(0,1fr)_186px] items-center gap-4">
                <span className="text-fs-text-primary truncate text-sm font-semibold">
                  {o.label || `Outcome ${i + 1}`}
                </span>
                <div className="flex items-center gap-2.5">
                  <label
                    className="fs-swatch-well rounded-fs bg-fs-surface-sunken border-fs-border relative inline-flex h-8 cursor-pointer items-center gap-2 border px-2"
                    title="Assigned automatically. Click to choose another."
                  >
                    <input
                      type="color"
                      value={/^#[0-9a-f]{6}$/i.test(o.color) ? o.color : "#9013fe"}
                      onChange={(e) => patchOutcome(o.id, { color: e.target.value, colorTouched: true })}
                      className="absolute h-0 w-0 border-none p-0 opacity-0"
                      aria-label={`Colour for ${o.label || `outcome ${i + 1}`}`}
                    />
                    <span
                      className="fs-swatch border-fs-border h-4 w-4 flex-none rounded-xs border"
                      style={{ background: /^#[0-9a-f]{6}$/i.test(o.color) ? o.color : "var(--fs-surface-tint)" }}
                    />
                    <input
                      className={clsx(
                        "h-6 w-21 bg-transparent px-1.5 font-mono text-xs outline-none",
                        /^#[0-9a-f]{6}$/i.test(o.color)
                          ? "border border-transparent"
                          : "border-fs-tone-error rounded-xs border",
                      )}
                      value={o.color}
                      onChange={(e) => {
                        const v = e.target.value.trim();
                        patchOutcome(o.id, { color: v.startsWith("#") ? v : `#${v}`, colorTouched: true });
                      }}
                      placeholder="#rrggbb"
                      aria-label={`Hex colour for ${o.label || `outcome ${i + 1}`}`}
                    />
                    <span className="type-caption text-fs-text-secondary whitespace-nowrap">
                      {o.colorTouched ? "yours" : "auto"}
                    </span>
                  </label>
                  {!isLegibleBranchColor(o.color) ? (
                    <Tooltip
                      place="left"
                      className={hintTooltipClass}
                      text="This colour falls below the contrast floor in one of the two themes. Branch colours key the whole session, so they have to stay legible in light and dark."
                    >
                      <span tabIndex={0} className="text-fs-tone-warning inline-flex cursor-help">
                        <ForesightIcon name="alert" size={16} />
                      </span>
                    </Tooltip>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="border-fs-border border-t pt-5">
          <AdvancedToggle
            open={advanced}
            onToggle={() => setAdvanced((v) => !v)}
            label="Description, images and card wording"
            summary={cardComplete ? "Complete" : "Required for the card"}
            summaryTone={cardComplete ? "muted" : "warning"}
          />
          {advanced ? (
            <div className="fs-spawn flex flex-col gap-6 pt-5">
              <TextArea
                className="w-full"
                inputProps={{ className: MARKDOWN_INPUT }}
                resizeY
                label="Session description"
                value={draft.description}
                onChange={(v) => setDraftField("description", v)}
                placeholder="The metric in plain words. This is the card's subtitle."
              />

              <div>
                <FieldLabel>
                  <span className="type-label text-fs-text-secondary">What one outcome is</span>
                  <InfoTip text="Singular and plural, used on the card: '3 Options' instead of '3 outcomes'." />
                </FieldLabel>
                <div className="grid max-w-md grid-cols-2 gap-2">
                  <div className="flex flex-col gap-1">
                    <span className="type-caption text-fs-text-secondary">Singular</span>
                    <TextField
                      className="w-full"
                      value={draft.itemName}
                      onChange={(v) => setDraftField("itemName", v)}
                      placeholder="Option"
                      aria-label="Item name, singular"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="type-caption text-fs-text-secondary">Plural</span>
                    <TextField
                      className="w-full"
                      value={draft.itemNamePlural}
                      onChange={(v) => setDraftField("itemNamePlural", v)}
                      placeholder="Options"
                      aria-label="Item name, plural"
                    />
                  </div>
                </div>
              </div>

              <div>
                <div className="type-label text-fs-text-secondary pb-1">Creator mark</div>
                <NamedFileUploader
                  label="Creator mark icon"
                  className={UPLOADER}
                  callback={(file) => pick("icon", "iconName", file)}
                  acceptedFileTypes={allowedOf(ICON_TYPES, restriction)}
                  validationFunction={(file) => withinLimit(file, "icon")}
                  selectedFile={getImageFile("icon")}
                  msg={tooBig.icon ?? "Add an icon, or leave it and one is generated for you"}
                  variant={tooBig.icon ? "error" : undefined}
                />
              </div>

              <div>
                <div className="type-label text-fs-text-secondary pb-1">Hero image</div>
                <NamedFileUploader
                  label="Hero image"
                  className={UPLOADER}
                  callback={(file) => pick("hero", "heroImageName", file)}
                  acceptedFileTypes={allowedOf(HERO_TYPES, restriction)}
                  validationFunction={(file) => withinLimit(file, "hero")}
                  selectedFile={getImageFile("hero")}
                  msg={tooBig.hero ?? `PNG or JPG${limitCopy}.`}
                  variant={tooBig.hero ? "error" : undefined}
                />
                <div className="type-caption text-fs-text-secondary pt-2 text-pretty">
                  Images stay on your device until you deploy, then they are uploaded with everything else.
                </div>
              </div>

              <div className="flex flex-col gap-5">
                {draft.outcomes.map((o, i) => {
                  const branch = o.label || `outcome ${i + 1}`;
                  return (
                    <div key={o.id} className="flex flex-col gap-2">
                      <MarkdownField
                        header={
                          <span className="text-fs-text-primary text-sm font-semibold">
                            {o.label || `Outcome ${i + 1}`}
                          </span>
                        }
                        value={o.detailsMarkdown}
                        onChange={(v) => patchOutcome(o.id, { detailsMarkdown: v })}
                        placeholder="Anything else about this branch, in Markdown"
                        ariaLabel={`Details for ${branch}`}
                      />
                      {o.images.map((image, j) => (
                        <GalleryImageRow
                          key={image.id}
                          image={image}
                          index={j}
                          branch={branch}
                          onTitle={(title) => patchImage(image.id, { title })}
                          onRemove={() => {
                            removeImage(image.id);
                            setImageFile(imageSlot(image.id), null);
                            // A size error belongs to the uploader, which this reopens.
                            setTooBig((current) => ({ ...current, [o.id]: null }));
                          }}
                        />
                      ))}
                      {o.images.length < MAX_IMAGE_BLOCKS ? (
                        <NamedFileUploader
                          label={`Image for ${branch}`}
                          className={UPLOADER}
                          // Remounting after each add clears the uploader for the next one.
                          key={o.images.length}
                          callback={(file) => addGalleryImage(o.id, file)}
                          acceptedFileTypes={allowedOf(HERO_TYPES, restriction)}
                          validationFunction={(file) => withinLimit(file, o.id)}
                          msg={
                            tooBig[o.id] ??
                            `Images for this branch, each with a title. PNG or JPG${limitCopy}, up to ${MAX_IMAGE_BLOCKS}.`
                          }
                          variant={tooBig[o.id] ? "error" : undefined}
                        />
                      ) : (
                        <div className="type-caption text-fs-text-secondary">
                          All {MAX_IMAGE_BLOCKS} image slots for this branch are used.
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function GalleryImageRow({
  image,
  index,
  branch,
  onTitle,
  onRemove,
}: {
  image: OutcomeImageDraft;
  index: number;
  /** Scopes the row's accessible names, since every branch counts its images from 1. */
  branch: string;
  onTitle: (title: string) => void;
  onRemove: () => void;
}) {
  const url = useImageUrl(imageSlot(image.id));
  const [openedFrom, setOpenedFrom] = useState<{ left: number; top: number; width: number; height: number } | null>(
    null,
  );
  const untitled = !image.title.trim();

  return (
    <div className="rounded-fs bg-fs-surface-sunken border-fs-border border px-2.5 py-2">
      <div className="flex items-center gap-3">
        {url ? (
          <button
            type="button"
            onClick={(event) => setOpenedFrom(event.currentTarget.getBoundingClientRect())}
            aria-label={`View image ${index + 1} of ${branch} full size`}
            className="h-10 w-10 flex-none cursor-zoom-in border-none bg-transparent p-0"
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- a local blob preview, which next/image cannot load */}
            <img src={url} alt="" className="rounded-xs border-fs-border h-full w-full border object-cover" />
          </button>
        ) : (
          <span className="rounded-xs bg-fs-surface-tint h-10 w-10 flex-none" />
        )}
        <TextField
          className="min-w-0 flex-1"
          value={image.title}
          onChange={onTitle}
          placeholder="What this image shows"
          aria-label={`Title for image ${index + 1} of ${branch}`}
          variant={untitled ? "warning" : undefined}
        />
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove image ${index + 1} of ${branch}`}
          className="fs-echo rounded-fs text-fs-text-secondary flex h-8 w-8 flex-none cursor-pointer items-center justify-center border-none bg-transparent"
        >
          <TrashIcon width={16} height={16} />
        </button>
      </div>
      {untitled ? (
        <div className="type-caption text-fs-tone-warning pt-1.5 pl-13">Required. Shown with the image.</div>
      ) : null}
      {openedFrom && url ? (
        <ImageLightbox
          src={url}
          alt={image.title || image.fileName}
          from={openedFrom}
          onClose={() => setOpenedFrom(null)}
        />
      ) : null}
    </div>
  );
}
