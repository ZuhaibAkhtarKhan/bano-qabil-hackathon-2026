import { describe, expect, it } from "vitest";

import { APPLICATION_BOARD_COLUMNS, boardColumnForStatus } from "@/lib/dashboard";

describe("application board", () => {
  it("maps pipeline, submitted, and closed statuses onto three columns", () => {
    expect(boardColumnForStatus("in_progress")).toBe("pipeline");
    expect(boardColumnForStatus("draft")).toBe("pipeline");
    expect(boardColumnForStatus("interview")).toBe("submitted");
    expect(boardColumnForStatus("offer")).toBe("closed");
    expect(APPLICATION_BOARD_COLUMNS).toHaveLength(3);
  });
});
