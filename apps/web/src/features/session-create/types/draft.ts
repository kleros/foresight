/**
 * The wizard draft: everything a creator types, exactly as typed.
 */
export type OutcomeDraft = {
  id: string;
  /** On-chain outcome label. Also seeds token and display name until touched. */
  label: string;
  token: string;
  tokenTouched: boolean;
  /** Metadata display name for the branch card. */
  displayName: string;
  color: string;
  colorTouched: boolean;
  detailsMarkdown: string;
  /** Images are held locally until deploy; only the name is drafted. */
  imageName: string | null;
  /** Per-branch overrides. */
  override: boolean;
  /** Overridden child question, without the unit. */
  childQuestion: string;
  lower: string;
  upper: string;
  metricDate: string;
  metricTime: string;
};

export type SessionDraft = {
  name: string;
  outcomes: OutcomeDraft[];
  multi: boolean;
  category: string;
  language: string;
  minBond: string;
  /** The decision date: `parent.openingTime`, the end of the trading period. */
  decisionDate: string;
  decisionTime: string;
  // child markets
  template: string;
  unit: string;
  lower: string;
  upper: string;
  // display metadata
  title: string;
  description: string;
  itemName: string;
  itemNamePlural: string;
  heroImageName: string | null;
  iconName: string | null;
};

export type WizardStep = 1 | 2 | 3;

export type DraftIssue = {
  step: WizardStep;
  text: string;
};

export type DraftAssessment = {
  issues: DraftIssue[];
  /**
   * Worth a second look, but not wrong: these never block a deploy. A bound
   * outside what its unit implies is the usual one, and it is legitimate often
   * enough that refusing it would be worse than saying so.
   */
  warnings: DraftIssue[];
  /** Per-step readiness for the rail and step badges. */
  steps: { parent: boolean; children: boolean; display: boolean };
  /** Per-outcome readiness for the rail's branch dots. */
  branchOk: boolean[];
  /** Per-outcome warnings, for the same dots. A branch can be ready and still warn. */
  branchWarn: boolean[];
};
