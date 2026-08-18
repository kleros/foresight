"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { useAtlasProvider } from "@kleros/kleros-app";
import { useAccount } from "wagmi";

import { ChildMarketsStep } from "@/features/session-create/components/ChildMarketsStep";
import { DeployStep } from "@/features/session-create/components/DeployStep";
import { DisplayMetadataStep } from "@/features/session-create/components/DisplayMetadataStep";
import { ParentMarketStep } from "@/features/session-create/components/ParentMarketStep";
import { ResumeBanner } from "@/features/session-create/components/ResumeBanner";
import { ReviewStep } from "@/features/session-create/components/ReviewStep";
import { SessionPreview } from "@/features/session-create/components/SessionPreview";
import { railState, StepRail, StepRailMobile, type RailEntry } from "@/features/session-create/components/StepRail";
import { useScrollSpy } from "@/features/session-create/hooks/useScrollSpy";
import { useSessionDeploy } from "@/features/session-create/hooks/useSessionDeploy";
import { useDraftStore } from "@/features/session-create/stores/draftStore";
import { reconcileImageNames, setImageFile } from "@/features/session-create/stores/imageStore";
import type { WizardStep } from "@/features/session-create/types/draft";
import { assessDraft } from "@/features/session-create/utils/assessDraft";
import { interrupted } from "@/features/session-create/utils/deployStages";

import EnsureAuth from "@/components/auth/EnsureAuth";
import { ConnectWallet } from "@/components/wallet/ConnectWallet";

import { uploadRestriction } from "@/lib/atlas/uploads";

import { DEFAULT_CHAIN_ID } from "@/config/chains";
import { IPFS_GATEWAY } from "@/config/ipfs";
import { paths } from "@/config/paths";

const SECTION_IDS = ["sec1", "sec2", "sec3", "sec4", "sec5"];

export function CreateSessionWizard() {
  const { draft, setDraftField, resetDraft } = useDraftStore();
  const { address, chainId } = useAccount();
  const { isVerified, roleRestrictions } = useAtlasProvider();
  const uploadLimits = uploadRestriction(roleRestrictions);
  const walletConnected = !!address && chainId === DEFAULT_CHAIN_ID;

  // The draft is persisted, so the first client render must match the server's
  // empty-state HTML before rehydrating.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);

  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  const assessment = useMemo(() => assessDraft(draft, now), [draft, now]);
  const { driver, progress } = useSessionDeploy(draft.outcomes.length);

  const railEntries = useMemo<RailEntry[]>(() => {
    const warned = (step: WizardStep) => assessment.warnings.some((w) => w.step === step);
    const entries: RailEntry[] = [
      {
        key: "1",
        num: "1",
        label: "Decision market",
        elementId: "sec1",
        state: railState(assessment.steps.parent, warned(1)),
      },
      {
        key: "2",
        num: "2",
        label: "Branch markets",
        elementId: "sec2",
        state: railState(assessment.steps.children, warned(2)),
      },
    ];
    draft.outcomes.forEach((o, i) => {
      entries.push({
        key: `2.${o.id}`,
        num: "",
        label: o.label.trim() || "Unnamed outcome",
        elementId: `branch-${i}`,
        sub: true,
        state: railState(assessment.branchOk[i] ?? false, assessment.branchWarn[i] ?? false),
      });
    });
    entries.push({
      key: "3",
      num: "3",
      label: "Display metadata",
      elementId: "sec3",
      state: railState(assessment.steps.display, warned(3)),
    });
    entries.push({
      key: "4",
      num: "4",
      label: "Review",
      elementId: "sec4",
      state: railState(assessment.issues.length === 0, assessment.warnings.length > 0),
    });
    entries.push({
      key: "5",
      num: "5",
      label: "Deploy",
      elementId: "sec5",
      state: railState(progress.stage === "complete", false),
    });
    return entries;
  }, [draft.outcomes, assessment, progress.stage]);

  // Only the steps are spied on: a branch is picked, never scrolled onto.
  const { index: stepIndex, goTo } = useScrollSpy(SECTION_IDS);
  const [pickedBranch, setPickedBranch] = useState<number | null>(null);

  const step = stepIndex + 1;
  const activeBranch = step === 2 ? pickedBranch : null;

  const stepEntryIndex = railEntries.findIndex((e) => e.elementId === SECTION_IDS[stepIndex]);
  // Removing an outcome leaves the pick pointing past the end of the list, and
  // the rail still has to mark something.
  const branchEntryIndex =
    activeBranch === null ? -1 : railEntries.findIndex((e) => e.key === `2.${draft.outcomes[activeBranch]?.id}`);
  const railIndex = branchEntryIndex === -1 ? stepEntryIndex : branchEntryIndex;

  // A step heading is the top of everything below it, so it sits at the top. A
  // branch is one row among many, and only reads as picked from the middle.
  const goToEntry = (target: number, elementId: string) => {
    const entry = railEntries[target];
    if (!entry) return;
    if (entry.sub) {
      setPickedBranch(railEntries.filter((e) => e.sub).indexOf(entry));
      goTo(SECTION_IDS.indexOf("sec2"), elementId, "center");
      return;
    }
    setPickedBranch(null);
    goTo(SECTION_IDS.indexOf(entry.elementId), elementId);
  };

  // Wider than `WizardStep`, which names the steps an issue can belong to: the
  // review and deploy sections are scrolled to but never carry one.
  const goToStep = (target: WizardStep | 4 | 5) => {
    setPickedBranch(null);
    goTo(target - 1, SECTION_IDS[target - 1] ?? SECTION_IDS[0]!);
  };

  const resetEverything = () => {
    resetDraft();
    setImageFile("hero", null);
    setImageFile("icon", null);
    driver.reset();
    setPickedBranch(null);
    goToStep(1);
  };

  // A reload keeps the draft but not the picked files.
  // Clearing the names asks for them again.
  useEffect(() => {
    if (!hydrated) return;
    for (const slot of reconcileImageNames({ hero: draft.heroImageName, icon: draft.iconName })) {
      setDraftField(slot === "hero" ? "heroImageName" : "iconName", null);
    }
    // Runs once, on the render that first sees the rehydrated draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated]);

  return (
    <div className="fs-wizard-grid pt-10">
      <StepRail
        entries={railEntries}
        index={railIndex}
        onGoTo={goToEntry}
        onReset={resetEverything}
        issueCount={assessment.issues.length}
        warningCount={assessment.warnings.length}
      />
      <StepRailMobile entries={railEntries} index={railIndex} onGoTo={goToEntry} />

      {/* Shell already owns the page's <main> landmark. */}
      <div className="pb-60">
        <nav className="type-label text-fs-text-secondary flex items-center gap-2 pb-6">
          <Link href={paths.home.getHref()}>Sessions</Link>
          <span>/</span>
          <span className="text-fs-text-primary font-semibold">Create session</span>
          <span className="flex-1" />
          {hydrated ? (
            <span className="type-caption text-fs-text-secondary whitespace-nowrap">Draft saved in this browser</span>
          ) : null}
        </nav>

        {interrupted(progress) ? <ResumeBanner progress={progress} onContinue={() => goToStep(5)} /> : null}

        <ParentMarketStep assessment={assessment} active={step === 1} />
        <ChildMarketsStep assessment={assessment} active={step === 2} activeBranch={activeBranch} />
        <DisplayMetadataStep assessment={assessment} active={step === 3} restriction={uploadLimits} />
        <ReviewStep assessment={assessment} active={step === 4} onGoToStep={goToStep} />
        <DeployStep
          assessment={assessment}
          active={step === 5}
          progress={progress}
          driver={driver}
          walletConnected={walletConnected}
          walletSlot={<ConnectWallet />}
          signedIn={isVerified}
          // `EnsureAuth` is the sign-in affordance the rest of the app uses; it
          // has nothing to reveal here because the deploy button lives beside
          // it, not behind it.
          signInSlot={<EnsureAuth text="Sign in">{null}</EnsureAuth>}
          gateway={IPFS_GATEWAY}
        />
      </div>

      <aside className="fs-side">
        <SessionPreview step={step} activeBranch={activeBranch} progress={progress} />
      </aside>
    </div>
  );
}
