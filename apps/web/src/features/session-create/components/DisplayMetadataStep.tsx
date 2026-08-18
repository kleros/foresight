import { useState } from "react";

import { FileUploader, TextArea, TextField, Tooltip } from "@kleros/ui-components-library";
import clsx from "clsx";

import { ForesightIcon } from "@/components/ui/ForesightIcon";

import { allowedOf, formatBytes, type UploadRestriction } from "@/lib/atlas/uploads";

import { AdvancedToggle, FieldLabel, hintTooltipClass, InfoTip } from "./fields";
import { SectionHeader } from "./SectionHeader";
import { useDraftStore } from "../stores/draftStore";
import { getImageFile, setImageFile, type ImageSlot } from "../stores/imageStore";
import type { DraftAssessment } from "../types/draft";
import { isLegibleBranchColor } from "../utils/branchColor";

const MARKDOWN_INPUT = "w-full text-sm";

/** What this step offers, before the role's own allow-list narrows it. */
const HERO_TYPES = ["image/png", "image/jpeg"];
const ICON_TYPES = [...HERO_TYPES, "image/svg+xml"];

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
  const { draft, setDraftField, patchOutcome } = useDraftStore();
  const [advanced, setAdvanced] = useState(true);

  const [tooBig, setTooBig] = useState<Record<ImageSlot, string | null>>({ hero: null, icon: null });

  const maxSize = restriction?.maxSize;
  const limitCopy = maxSize ? `, up to ${formatBytes(maxSize)}` : "";

  /**
   * Atlas rejects an oversized file itself, at the start of the deploy. Catching
   * it here only moves that failure to the step that can still fix it.
   */
  const withinLimit = (file: File | undefined, slot: ImageSlot) => {
    const over = !!file && !!maxSize && file.size > maxSize;
    setTooBig((current) => ({
      ...current,
      [slot]:
        over && maxSize ? `${file.name} is ${formatBytes(file.size)}. The limit is ${formatBytes(maxSize)}.` : null,
    }));
    return !!file && !over;
  };

  const pick = (slot: ImageSlot, field: "heroImageName" | "iconName", file: File) => {
    setImageFile(slot, file);
    setDraftField(field, file.name);
  };

  const cardComplete = !!draft.description.trim() && !!draft.heroImageName && !!draft.iconName;

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
        <ForesightIcon name="registered" size={18} className="text-fs-accent-protocol" />
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
          placeholder="A short name for this session"
          variant={draft.title.trim() ? undefined : "warning"}
          message={draft.title.trim() ? undefined : "Required. The card has nothing to be called."}
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
                          : "border-fs-status-disputed rounded-xs border",
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
                      <span tabIndex={0} className="text-fs-status-pending inline-flex cursor-help">
                        <ForesightIcon name="challenged" size={16} />
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
                <FileUploader
                  className="w-full"
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
                <FileUploader
                  className="w-full"
                  callback={(file) => pick("hero", "heroImageName", file)}
                  acceptedFileTypes={allowedOf(HERO_TYPES, restriction)}
                  validationFunction={(file) => withinLimit(file, "hero")}
                  selectedFile={getImageFile("hero")}
                  msg={tooBig.hero ?? `PNG or JPG${limitCopy}. Held locally until you deploy.`}
                  variant={tooBig.hero ? "error" : undefined}
                />
                <div className="type-caption text-fs-text-secondary pt-2 text-pretty">
                  Images stay on your device until you deploy, then they are uploaded with everything else.
                </div>
              </div>

              <div className="flex flex-col gap-2">
                {draft.outcomes.map((o, i) => (
                  <div key={o.id} className="flex flex-col gap-1.5">
                    <span className="text-fs-text-primary text-sm font-semibold">{o.label || `Outcome ${i + 1}`}</span>
                    <TextArea
                      className="w-full"
                      inputProps={{ className: MARKDOWN_INPUT }}
                      resizeY
                      value={o.detailsMarkdown}
                      onChange={(v) => patchOutcome(o.id, { detailsMarkdown: v })}
                      placeholder="Anything else about this branch, in Markdown"
                      aria-label={`Details for ${o.label || `outcome ${i + 1}`}`}
                    />
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
