import { describe, expect, it } from "vite-plus/test";

import {
  dockSlots,
  floatingActivityHeading,
  nearestDock,
  floatingReplyPreview,
  plainTextLine,
} from "./floatingComposer.logic";

const row = (
  type: string,
  text: string,
  runId: string | null = "run-2",
  streaming = false,
  id = `${type}-${text.length}`,
) => ({ item: { type, id, runId, text, streaming } });

describe("plainTextLine", () => {
  it("returns the first readable line without markdown syntax", () => {
    expect(plainTextLine("\n## Plan\n- second")).toBe("Plan");
    expect(plainTextLine("**Fixed** the `parser` in [the docs](https://x.y)")).toBe(
      "Fixed the parser in the docs",
    );
    expect(plainTextLine("> quoted *emphasis* here")).toBe("quoted emphasis here");
  });

  it("skips fenced code and keeps snake_case intact", () => {
    expect(plainTextLine("```ts\nconst a = 1;\n```\nRenamed max_width")).toBe("Renamed max_width");
  });
});

describe("floatingActivityHeading", () => {
  it("prefers the latest reasoning title over earlier assistant text", () => {
    const rows = [
      row("assistant_message", "Looking at the composer first."),
      row("reasoning", "**Inspecting the diff panel**\n\nDetails follow."),
    ];
    expect(floatingActivityHeading(rows, "run-2")).toBe("Inspecting the diff panel");
  });

  it("falls back to the latest assistant text and ignores other runs and empty items", () => {
    const rows = [
      row("reasoning", "**Old run**", "run-1"),
      row("assistant_message", "Updating the tests now.\nMore detail."),
      row("reasoning", "   "),
      row("tool_call", "npm test"),
    ];
    expect(floatingActivityHeading(rows, "run-2")).toBe("Updating the tests now.");
    expect(floatingActivityHeading([row("tool_call", "x")], "run-2")).toBeNull();
    expect(floatingActivityHeading(rows, null)).toBeNull();
  });
});

describe("floatingReplyPreview", () => {
  it("returns the run's finished reply and nothing while it still streams", () => {
    const done = [row("assistant_message", "## Done\nAll green.", "run-2", false, "reply-1")];
    expect(floatingReplyPreview(done, "run-2")).toEqual({ key: "reply-1", text: "Done" });
    const streaming = [row("assistant_message", "Writ", "run-2", true)];
    expect(floatingReplyPreview(streaming, "run-2")).toBeNull();
    expect(floatingReplyPreview(done, "run-1")).toBeNull();
  });
});

describe("dockSlots and nearestDock", () => {
  const slots = dockSlots(100, 1000, 600);

  it("places the composer flush left, centered, and flush right", () => {
    expect(slots).toEqual({ left: 100, center: 300, right: 500 });
    expect(dockSlots(100, 500, 600)).toEqual({ left: 100, center: 100, right: 100 });
  });

  it("snaps to the slot nearest the composer's position, not the pointer's", () => {
    expect(nearestDock(120, slots)).toBe("left");
    expect(nearestDock(260, slots)).toBe("center");
    expect(nearestDock(420, slots)).toBe("right");
    expect(nearestDock(199, slots)).toBe("left");
    expect(nearestDock(200, slots)).toBe("center");
  });
});
