/** The slice of a projected turn item the floating composer reads. */
type TurnItemRow = {
  readonly item: { readonly type: string; readonly id: string; readonly runId: string | null } & {
    readonly text?: string;
    readonly streaming?: boolean;
  };
};

export type FloatingComposerDock = "left" | "center" | "right";

/** First readable line of markdown, without block markers or inline emphasis. */
export function plainTextLine(markdown: string): string {
  let inFence = false;
  for (const rawLine of markdown.split("\n")) {
    if (/^\s*(```|~~~)/.test(rawLine)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const line = rawLine
      .replace(/^\s{0,3}(?:#{1,6}\s+|>\s?|[-*+]\s+|\d+[.)]\s+)/, "")
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/\*\*|__|~~|`/g, "")
      .replace(/\*([^*\s][^*]*)\*/g, "$1")
      .replace(/\s+/g, " ")
      .trim();
    if (line) return line;
  }
  return "";
}

/** Reasoning summaries lead with a bold title; fall back to their first line. */
function reasoningHeading(text: string): string {
  const title = /^\s*\*\*(.+?)\*\*/.exec(text)?.[1]?.trim();
  return title || plainTextLine(text);
}

/**
 * What the agent is doing right now in `runId`: the latest reasoning title or,
 * failing that, the latest assistant text. Null until either has content.
 */
export function floatingActivityHeading(
  rows: ReadonlyArray<TurnItemRow>,
  runId: string | null,
): string | null {
  if (runId === null) return null;
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const item = rows[index]?.item;
    if (!item || item.runId !== runId) continue;
    if (item.type === "reasoning") {
      const heading = reasoningHeading(item.text ?? "");
      if (heading) return heading;
    } else if (item.type === "assistant_message") {
      const line = plainTextLine(item.text ?? "");
      if (line) return line;
    }
  }
  return null;
}

/** The finished reply of `runId`, keyed so a dismissed preview stays dismissed. */
export function floatingReplyPreview(
  rows: ReadonlyArray<TurnItemRow>,
  runId: string | null,
): { key: string; text: string } | null {
  if (runId === null) return null;
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const item = rows[index]?.item;
    if (!item || item.runId !== runId || item.type !== "assistant_message") continue;
    if (item.streaming) return null;
    return { key: item.id, text: plainTextLine(item.text ?? "") };
  }
  return null;
}

/** Left edge of the composer in each dock slot, within a lane's content box. */
export function dockSlots(
  contentLeft: number,
  contentWidth: number,
  itemWidth: number,
): Record<FloatingComposerDock, number> {
  const free = Math.max(0, contentWidth - itemWidth);
  return { left: contentLeft, center: contentLeft + free / 2, right: contentLeft + free };
}

/** The slot whose resting position is closest to where the composer currently sits. */
export function nearestDock(
  itemLeft: number,
  slots: Record<FloatingComposerDock, number>,
): FloatingComposerDock {
  let best: FloatingComposerDock = "center";
  for (const dock of ["left", "center", "right"] as const) {
    if (Math.abs(slots[dock] - itemLeft) < Math.abs(slots[best] - itemLeft)) best = dock;
  }
  return best;
}
