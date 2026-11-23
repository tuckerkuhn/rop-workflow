import { describe, expect, it } from "vitest";
import { afterTrainInputs, leaveTrain, seedField, type Farmer } from "@/lib/field";
import { selectionHold } from "@/lib/selection";

/** The move on from Train, one rule wherever its inputs change (lib/field leaveTrain). */
const base = seedField().find((i): i is Farmer => i.kind === "farmer")!;
const atTrain = (over: Partial<Farmer>): Farmer => ({ ...base, id: "F-0100", step: "train", timeline: [], checks: { "train.attended": true, "train.register": true }, enrolled: true, contributionPaid: true, ...over });

describe("the Train rule", () => {
  it("moves on a farmer trained while not enrolled once enrolment is recorded", () => {
    const stuck = atTrain({ enrolled: false });
    const after = afterTrainInputs(stuck, { ...stuck, enrolled: true }, "2026-11-20") as Farmer;
    expect(after.step).toBe("prepare");
    expect(after.timeline.at(-1)!.what).toBe("Enrolment recorded; training already recorded from KoboCollect: moved to Prepare the plot");
  });

  it("moves on once the contribution is recorded, and not before both hold", () => {
    const stuck = atTrain({ enrolled: false, contributionPaid: false });
    const paid = afterTrainInputs(stuck, { ...stuck, contributionPaid: true }, "2026-11-20") as Farmer;
    expect(paid.step).toBe("train");
    const both = afterTrainInputs(paid, { ...paid, enrolled: true }, "2026-11-21") as Farmer;
    expect(both.step).toBe("prepare");
  });

  it("does nothing when no input changed, or the training is not recorded", () => {
    const f = atTrain({});
    expect(afterTrainInputs(f, { ...f, issues: [] }, "2026-11-20")).toEqual({ ...f, issues: [] });
    const untrained = atTrain({ enrolled: false, checks: {} });
    expect((afterTrainInputs(untrained, { ...untrained, enrolled: true }, "2026-11-20") as Farmer).step).toBe("train");
  });

  it("never moves on a farmer waitlisted or left out in Farmer selection, and says why", () => {
    const hold = selectionHold({ "F-0100": "waitlisted" }, "F-0100");
    expect(hold).toBe("F-0100 is waitlisted in Farmer selection");
    expect(selectionHold({ "F-0100": "not_selected" }, "F-0100")).toBe("F-0100 is marked Not selected in Farmer selection");
    expect(selectionHold({ "F-0100": "selected" }, "F-0100")).toBeNull();
    expect(selectionHold(null, "F-0100")).toBeNull();
    const stuck = atTrain({ contributionPaid: false });
    const held = afterTrainInputs(stuck, { ...stuck, contributionPaid: true }, "2026-11-20", hold) as Farmer;
    expect(held.step).toBe("train");
    expect(held.timeline.at(-1)!.what).toBe("Contribution received; training already recorded, but stays at Train: F-0100 is waitlisted in Farmer selection");
    // Selected later: the same rule moves them on.
    expect(leaveTrain(held, "2026-11-22", "Selected in Farmer selection").step).toBe("prepare");
  });
});
