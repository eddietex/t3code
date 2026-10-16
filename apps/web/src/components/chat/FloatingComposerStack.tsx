import * as Schema from "effect/Schema";
import {
  CheckIcon,
  GripVerticalIcon,
  MessageCircleIcon,
  MessagesSquareIcon,
  MinusIcon,
  XIcon,
} from "lucide-react";
import {
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { useLocalStorage } from "~/hooks/useLocalStorage";
import { cn } from "~/lib/utils";

import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { dockSlots, type FloatingComposerDock, nearestDock } from "./floatingComposer.logic";
import { WorkingTimer } from "./WorkingTimer";

export type FloatingComposerStatus = "idle" | "working" | "approval" | "input";

const DOCK_STORAGE_KEY = "t3code:floating-composer-dock:v1";
const DockSchema = Schema.Literals(["left", "center", "right"]);
const DOCK_ORDER: ReadonlyArray<FloatingComposerDock> = ["left", "center", "right"];
const DRAG_THRESHOLD_PX = 4;
const SETTLE_MS = 220;

const isInCard = (target: EventTarget) =>
  target instanceof Element && target.closest("[data-floating-composer-card]") !== null;

/** A collapsed composer never keeps focus, or typing would land out of sight. */
function releaseFocus(stack: HTMLElement | null) {
  const active = document.activeElement;
  if (active instanceof HTMLElement && stack?.contains(active)) active.blur();
}

/** Spinner, elapsed time, and what the agent is doing, on one truncated line. */
function WorkingStatus({
  startedAt,
  activity,
}: {
  startedAt: string | null;
  activity: string | null;
}) {
  return (
    <>
      <Spinner size="sm" tone="muted" aria-label="Working" />
      <span className="shrink-0">
        {startedAt ? (
          <>
            Working for <WorkingTimer createdAt={startedAt} />
          </>
        ) : (
          "Working…"
        )}
      </span>
      <span className="min-w-0 truncate text-muted-foreground">· {activity ?? "Thinking…"}</span>
    </>
  );
}

function IconAction({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button aria-label={label} onClick={onClick} size="icon-xs" variant="glass">
            {children}
          </Button>
        }
      />
      <TooltipPopup side="top">{label}</TooltipPopup>
    </Tooltip>
  );
}

/**
 * The composer stack. While `floating`, the composer sits over a maximized
 * right panel and collapses to a pill: hovering or focusing it opens the
 * composer. Leaving with the pointer closes it unless there is a draft, which
 * focus keeps open until focus leaves or a send empties it. A pending
 * approval or question holds it open. React bubbles these events through
 * portals, so the composer's own menus keep it open. `onOpen` should move
 * focus into the composer; `onShowChat` should bring the conversation back.
 */
export function FloatingComposerStack({
  floating,
  status,
  workStartedAt,
  activity,
  reply,
  threadTitle,
  onOpen,
  onShowChat,
  hasDraft,
  children,
}: {
  floating: boolean;
  status: FloatingComposerStatus;
  workStartedAt: string | null;
  activity: string | null;
  reply: { key: string; text: string } | null;
  threadTitle: string;
  onOpen: () => void;
  onShowChat: () => void;
  hasDraft: boolean;
  children: ReactNode;
}) {
  const stackRef = useRef<HTMLDivElement | null>(null);
  const insidePressRef = useRef<Event | null>(null);
  const ghostRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    restLeft: number;
    slots: Record<FloatingComposerDock, number>;
    target: FloatingComposerDock;
    moved: boolean;
  } | null>(null);
  const settleFromRef = useRef<number | null>(null);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [dragTarget, setDragTarget] = useState<FloatingComposerDock | null>(null);
  const [dock, setDock] = useLocalStorage(DOCK_STORAGE_KEY, "center", DockSchema);

  // After a drop or an arrow key, the composer glides from where it was into
  // its slot instead of jumping there.
  useLayoutEffect(() => {
    const from = settleFromRef.current;
    const stack = stackRef.current;
    if (from === null || !stack) return;
    settleFromRef.current = null;
    stack.style.transition = "none";
    stack.style.translate = "";
    const delta = from - stack.getBoundingClientRect().left;
    if (Math.abs(delta) < 1 || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      stack.style.transition = "";
      return;
    }
    stack.style.translate = `${delta}px 0`;
    void stack.offsetWidth;
    stack.style.transition = `translate ${SETTLE_MS}ms cubic-bezier(0.22, 1, 0.36, 1)`;
    stack.style.translate = "0px 0";
    // transitionend is skipped when a glide is interrupted, so a timer backs it up.
    const timer = window.setTimeout(() => settled(), SETTLE_MS + 80);
    const settled = () => {
      window.clearTimeout(timer);
      stack.removeEventListener("transitionend", settled);
      stack.style.transition = "";
      stack.style.translate = "";
    };
    stack.addEventListener("transitionend", settled, { once: true });
  });

  // A reply that lands while the conversation is out of sight waits here until
  // it is opened or dismissed. Adjusted during render so it never lags a frame.
  const [observed, setObserved] = useState({ status, floating });
  const [replyPending, setReplyPending] = useState(false);
  if (observed.status !== status || observed.floating !== floating) {
    setObserved({ status, floating });
    if (!floating || status === "working") setReplyPending(false);
    else if (observed.status === "working" && status === "idle") setReplyPending(true);
  }
  const replyReady = floating && replyPending && status === "idle" && reply !== null;

  const forcedOpen = floating && (status === "approval" || status === "input");
  const open = forcedOpen || hovered || focused;
  const collapsed = floating && !open;

  // A send empties the composer after the pointer may already have left, so
  // an emptied composer tucks away unless the pointer is still on it.
  const hadDraftRef = useRef(hasDraft);
  useEffect(() => {
    const hadDraft = hadDraftRef.current;
    hadDraftRef.current = hasDraft;
    if (hadDraft && !hasDraft && floating && !hovered && !forcedOpen) {
      releaseFocus(stackRef.current);
    }
  }, [hasDraft, floating, hovered, forcedOpen]);

  // A press anywhere else is the way out: a menu closing under the pointer
  // never reports a leave, and touch never blurs on its own.
  useEffect(() => {
    if (!floating || !open) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (insidePressRef.current === event) return;
      setHovered(false);
      releaseFocus(stackRef.current);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [floating, open]);

  // The pill and the composer open on hover; the completion card does not, so
  // it stays clickable.
  const hoverIn = (event: ReactPointerEvent) => {
    if (event.pointerType !== "touch") setHovered(true);
  };
  const minimize = () => {
    setHovered(false);
    releaseFocus(stackRef.current);
  };
  const showChat = () => {
    setReplyPending(false);
    onShowChat();
  };

  const moveToDock = (next: FloatingComposerDock) => {
    settleFromRef.current = stackRef.current?.getBoundingClientRect().left ?? null;
    setDock(next);
  };

  // The grip drags the open composer sideways within the panel. Moves write the
  // DOM directly so dragging never re-renders the composer; an outline shows the
  // slot it will settle into, chosen by where the composer is, not the pointer.
  const onGripPointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const stack = stackRef.current;
    const lane = stack?.parentElement;
    if (event.button !== 0 || !stack || !lane) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    // Grabbing mid-glide picks it up from its slot.
    stack.style.transition = "";
    stack.style.translate = "";
    const laneBox = lane.getBoundingClientRect();
    const laneStyle = getComputedStyle(lane);
    const padStart = Number.parseFloat(laneStyle.paddingLeft);
    const padEnd = Number.parseFloat(laneStyle.paddingRight);
    const stackBox = stack.getBoundingClientRect();
    const shell = stack.querySelector('[data-slot="composer-shell"]')?.getBoundingClientRect();
    const ghost = ghostRef.current;
    if (ghost && shell) {
      ghost.style.top = `${shell.top - stackBox.top}px`;
      ghost.style.height = `${shell.height}px`;
    }
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      restLeft: stackBox.left,
      slots: dockSlots(laneBox.left + padStart, laneBox.width - padStart - padEnd, stackBox.width),
      target: dock,
      moved: false,
    };
  };
  const onGripPointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    const stack = stackRef.current;
    if (!drag || !stack || drag.pointerId !== event.pointerId) return;
    const pointerOffset = event.clientX - drag.startX;
    if (!drag.moved && Math.abs(pointerOffset) < DRAG_THRESHOLD_PX) return;
    const left = Math.min(
      Math.max(drag.restLeft + pointerOffset, drag.slots.left),
      drag.slots.right,
    );
    stack.style.translate = `${left - drag.restLeft}px 0`;
    const target = nearestDock(left, drag.slots);
    if (ghostRef.current) ghostRef.current.style.translate = `${drag.slots[target] - left}px 0`;
    if (!drag.moved || target !== drag.target) setDragTarget(target);
    drag.moved = true;
    drag.target = target;
  };
  const onGripPointerUp = () => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag?.moved) return;
    setDragTarget(null);
    moveToDock(drag.target);
  };

  return (
    <div
      ref={stackRef}
      data-chat-composer-stack="true"
      data-floating-composer={floating ? (open ? "open" : "collapsed") : undefined}
      className={cn(
        "group/composer-stack relative z-10 w-full max-w-(--chat-content-max-width)",
        !floating || dock === "center" ? "mx-auto" : dock === "left" ? "me-auto" : "ms-auto",
        collapsed ? "pointer-events-none" : "pointer-events-auto",
        floating && "visible",
      )}
      onPointerLeave={() => {
        setHovered(false);
        // An empty composer, such as right after a send, tucks away with the pointer.
        if (floating && !forcedOpen && !hasDraft) releaseFocus(stackRef.current);
      }}
      onPointerDownCapture={(event) => {
        insidePressRef.current = event.nativeEvent;
      }}
      onFocus={(event) => {
        if (!isInCard(event.target)) setFocused(true);
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
      }}
    >
      {floating && open ? (
        <div
          className="absolute inset-x-0 bottom-full z-20 flex items-center gap-2 pb-2"
          onPointerEnter={hoverIn}
        >
          <div className="flex min-w-0 flex-1">
            {status === "working" ? (
              <div className="surface-glass flex min-w-0 items-center gap-1.5 rounded-full border border-border/60 px-2.5 py-1 text-xs shadow-sm">
                <WorkingStatus startedAt={workStartedAt} activity={activity} />
              </div>
            ) : replyReady ? (
              <div className="surface-glass flex min-w-0 items-center rounded-full border border-border/60 text-xs shadow-sm">
                <button
                  type="button"
                  className="flex min-w-0 items-center gap-1.5 rounded-full py-1 ps-2.5 pe-1 text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                  onClick={showChat}
                >
                  <CheckIcon aria-hidden className="size-3.5 shrink-0 text-success" />
                  <span className="min-w-0 truncate">
                    Response ready
                    {reply?.text ? (
                      <span className="text-muted-foreground"> · {reply.text}</span>
                    ) : null}
                  </span>
                </button>
                <button
                  type="button"
                  aria-label="Dismiss"
                  className="me-1 flex size-5 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                  onClick={() => setReplyPending(false)}
                >
                  <XIcon aria-hidden className="size-3" />
                </button>
              </div>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    aria-label="Move composer"
                    className="cursor-grab touch-none active:cursor-grabbing"
                    size="icon-xs"
                    variant="glass"
                    onPointerDown={onGripPointerDown}
                    onPointerMove={onGripPointerMove}
                    onPointerUp={onGripPointerUp}
                    onPointerCancel={onGripPointerUp}
                    onKeyDown={(event) => {
                      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
                      event.preventDefault();
                      const index = DOCK_ORDER.indexOf(dock) + (event.key === "ArrowLeft" ? -1 : 1);
                      const next = DOCK_ORDER[index];
                      if (next) moveToDock(next);
                    }}
                  >
                    <GripVerticalIcon />
                  </Button>
                }
              />
              <TooltipPopup side="top">Drag to move</TooltipPopup>
            </Tooltip>
            <IconAction label="Show chat" onClick={showChat}>
              <MessagesSquareIcon />
            </IconAction>
            {forcedOpen ? null : (
              <IconAction label="Minimize composer" onClick={minimize}>
                <MinusIcon />
              </IconAction>
            )}
          </div>
        </div>
      ) : null}
      {floating ? (
        <div
          className={cn(
            "pointer-events-none absolute inset-x-0 bottom-3 z-20 flex flex-col gap-2 motion-safe:transition-opacity motion-safe:duration-150",
            dock === "left" ? "items-start" : dock === "right" ? "items-end" : "items-center",
            open && "opacity-0",
          )}
        >
          {replyReady ? (
            <div
              data-floating-composer-card
              className="surface-glass pointer-events-auto relative w-full max-w-sm rounded-2xl border border-border/60 shadow-lg"
              role="status"
              inert={open}
            >
              <button
                type="button"
                aria-label={`Open completed response: ${threadTitle}`}
                className="block w-full min-w-0 rounded-[inherit] px-4 py-3 text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                onClick={showChat}
              >
                <span className="flex min-w-0 items-center gap-2 text-sm font-medium">
                  <CheckIcon aria-hidden className="size-4 shrink-0 text-success" />
                  <span className="truncate">{threadTitle}</span>
                </span>
                <span className="mt-0.5 block truncate text-sm text-muted-foreground">
                  {reply?.text || "Response ready"}
                </span>
              </button>
              <span className="absolute -top-1.5 -left-1.5">
                <IconAction label="Dismiss" onClick={() => setReplyPending(false)}>
                  <XIcon />
                </IconAction>
              </span>
            </div>
          ) : null}
          <Button
            inert={open}
            onClick={onOpen}
            onFocus={onOpen}
            onPointerEnter={hoverIn}
            className="pointer-events-auto max-w-md min-w-0"
            size="sm"
            variant="glass"
          >
            {status === "working" ? (
              <WorkingStatus startedAt={workStartedAt} activity={activity} />
            ) : replyReady ? (
              <>
                <span aria-hidden className="size-1.5 rounded-full bg-info" />
                Response ready
              </>
            ) : (
              <>
                <MessageCircleIcon className="size-3.5" />
                Ask for changes
              </>
            )}
          </Button>
        </div>
      ) : null}
      {floating && open ? (
        <div
          ref={ghostRef}
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-x-0 rounded-3xl border-2 border-dashed border-primary/45 bg-primary/5 motion-safe:transition-opacity motion-safe:duration-150",
            dragTarget === null && "opacity-0",
          )}
        />
      ) : null}
      <div
        className={cn(
          floating &&
            "origin-bottom motion-safe:transition-[opacity,translate,scale] motion-safe:duration-150 motion-safe:ease-out",
          collapsed && "translate-y-2 scale-[0.98] opacity-0 **:pointer-events-none!",
        )}
        onPointerEnter={hoverIn}
      >
        {children}
      </div>
    </div>
  );
}
