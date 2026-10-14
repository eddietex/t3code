import { MessageCircleIcon } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";

import { cn } from "~/lib/utils";

import { Button } from "../ui/button";

export type FloatingComposerStatus = "idle" | "working" | "approval" | "input";

const STATUS_LABEL: Record<FloatingComposerStatus, string> = {
  idle: "Ask for changes",
  working: "Working…",
  approval: "Awaiting approval",
  input: "Needs input",
};

/** A collapsed composer never keeps focus, or typing would land out of sight. */
function releaseFocus(stack: HTMLElement | null) {
  const active = document.activeElement;
  if (active instanceof HTMLElement && stack?.contains(active)) active.blur();
}

/**
 * The composer stack. While `floating`, the composer sits over a maximized
 * right panel and collapses to a pill: hovering or focusing it opens the
 * composer. Leaving with the pointer closes it unless `hasDraft` reports work
 * in progress, which focus keeps open until focus leaves too. React bubbles
 * these events through portals, so the composer's own menus keep it open.
 * `onOpen` should move focus into the composer.
 */
export function FloatingComposerStack({
  floating,
  status,
  onOpen,
  hasDraft,
  children,
}: {
  floating: boolean;
  status: FloatingComposerStatus;
  onOpen: () => void;
  hasDraft: () => boolean;
  children: ReactNode;
}) {
  const stackRef = useRef<HTMLDivElement | null>(null);
  const insidePressRef = useRef<Event | null>(null);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const open = hovered || focused;
  const collapsed = floating && !open;

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

  return (
    <div
      ref={stackRef}
      data-chat-composer-stack="true"
      data-floating-composer={floating ? (open ? "open" : "collapsed") : undefined}
      className={cn(
        "group/composer-stack relative z-10 mx-auto w-full max-w-(--chat-content-max-width)",
        collapsed ? "pointer-events-none" : "pointer-events-auto",
        floating && "visible",
      )}
      onPointerEnter={(event) => {
        if (event.pointerType !== "touch") setHovered(true);
      }}
      onPointerLeave={() => {
        setHovered(false);
        // An empty composer, such as right after a send, tucks away with the pointer.
        if (floating && !hasDraft()) releaseFocus(stackRef.current);
      }}
      onPointerDownCapture={(event) => {
        insidePressRef.current = event.nativeEvent;
      }}
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
      }}
    >
      {floating ? (
        <div
          className={cn(
            "pointer-events-none absolute inset-x-0 bottom-3 z-20 flex justify-center motion-safe:transition-opacity motion-safe:duration-150",
            open && "opacity-0",
          )}
        >
          <Button
            inert={open}
            onClick={onOpen}
            onFocus={onOpen}
            className="pointer-events-auto"
            size="sm"
            variant="glass"
          >
            {status === "idle" ? (
              <MessageCircleIcon className="size-3.5" />
            ) : (
              <span
                aria-hidden
                className={cn(
                  "size-1.5 rounded-full",
                  status === "working" ? "bg-info" : "bg-warning",
                )}
              />
            )}
            {STATUS_LABEL[status]}
          </Button>
        </div>
      ) : null}
      <div
        className={cn(
          floating &&
            "origin-bottom motion-safe:transition-[opacity,translate,scale] motion-safe:duration-150 motion-safe:ease-out",
          collapsed && "translate-y-2 scale-[0.98] opacity-0 **:pointer-events-none!",
        )}
      >
        {children}
      </div>
    </div>
  );
}
