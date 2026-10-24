import type { CornerKind } from "@overhand/contract";
import type { WordKey, Words } from "@overhand/themes";

const LABEL: Record<CornerKind, WordKey> = {
  "test-deleted": "cornerTestDeleted",
  "tests-removed": "cornerTestsRemoved",
  "assertions-removed": "cornerAssertionsRemoved",
  "test-skipped": "cornerTestSkipped",
  "test-focused": "cornerTestFocused",
  "check-loosened": "cornerCheckLoosened",
  "threshold-lowered": "cornerThresholdLowered",
  "ci-weakened": "cornerCiWeakened",
  "snapshots-rewritten": "cornerSnapshotsRewritten",
  secret: "cornerSecret",
};

/** A cut-corner finding's kind in the theme's words ("Test skipped"). */
export const cornerWord = (w: Words, kind: CornerKind): string => w[LABEL[kind]];
