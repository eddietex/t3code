import { MessageCircleIcon, MessagesSquareIcon, MinusIcon } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";

import { cn } from "~/lib/utils";

import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { WorkingTimer } from "./WorkingTimer";

export type FloatingComposerStatus = "idle" | "working" | "approval" | "input";

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
 * right panel as a pill. Clicking the pill, or anything that focuses the
 * composer, opens it; Minimize, Escape, and sending (a new `sentAt`) close it.
 * A pending approval or question keeps it open. `onOpen` should focus the
 * composer; `onShowChat` should bring the conversation back.
 */
export function FloatingComposerStack({
  floating,
  status,
  workStartedAt,
  sentAt,
  onOpen,
  onShowChat,
  children,
}: {
  floating: boolean;
  status: FloatingComposerStatus;
  workStartedAt: string | null;
  sentAt: string | null;
  onOpen: () => void;
  onShowChat: () => void;
  children: ReactNode;
}) {
  const stackRef = useRef<HTMLDivElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const [expanded, setExpanded] = useState(false);

  // Each send tucks the composer away so the pill can show the agent working.
  const [seenSentAt, setSeenSentAt] = useState(sentAt);
  if (seenSentAt !== sentAt) {
    setSeenSentAt(sentAt);
    if (sentAt !== null) setExpanded(false);
  }

  const forcedOpen = floating && (status === "approval" || status === "input");
  const open = !floating || forcedOpen || expanded;

  // A collapsed composer never keeps focus, or typing would land out of sight.
  // Focus goes back to wherever it was before the composer opened.
  useEffect(() => {
    const stack = stackRef.current;
    const active = document.activeElement;
    if (open || !stack || !(active instanceof HTMLElement) || !stack.contains(active)) return;
    const previous = returnFocusRef.current;
    returnFocusRef.current = null;
    if (previous?.isConnected && !stack.contains(previous)) previous.focus({ preventScroll: true });
    else active.blur();
  }, [open]);

  return (
    <div
      ref={stackRef}
      data-chat-composer-stack="true"
      data-floating-composer={floating ? (open ? "open" : "collapsed") : undefined}
      className={cn(
        "group/composer-stack relative z-10 mx-auto w-full max-w-(--chat-content-max-width)",
        open ? "pointer-events-auto" : "pointer-events-none",
        floating && "visible",
      )}
      onFocus={(event) => {
        if (!floating || expanded) return;
        if (event.relatedTarget instanceof HTMLElement)
          returnFocusRef.current = event.relatedTarget;
        setExpanded(true);
      }}
      onKeyDown={(event) => {
        // Composer menus stop an Escape they consume. ProseMirror prevents the
        // default of every Escape, so `defaultPrevented` says nothing here.
        // Portaled popovers bubble here through React but own their Escape,
        // so only keys from the stack's own DOM count.
        if (
          !floating ||
          forcedOpen ||
          event.key !== "Escape" ||
          event.nativeEvent.isComposing ||
          !(event.target instanceof Node && event.currentTarget.contains(event.target))
        )
          return;
        event.preventDefault();
        setExpanded(false);
      }}
    >
      {floating && open ? (
        <div className="absolute end-0 bottom-full z-20 flex items-center gap-1 pb-2">
          <IconAction label="Show chat" onClick={onShowChat}>
            <MessagesSquareIcon />
          </IconAction>
          {forcedOpen ? null : (
            <IconAction label="Minimize composer" onClick={() => setExpanded(false)}>
              <MinusIcon />
            </IconAction>
          )}
        </div>
      ) : null}
      {floating && !open ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-3 z-20 flex justify-center">
          <Button
            aria-label="Open composer"
            className="pointer-events-auto"
            size="sm"
            variant="glass"
            onClick={() => {
              const active = document.activeElement;
              if (active instanceof HTMLElement) returnFocusRef.current = active;
              setExpanded(true);
              onOpen();
            }}
          >
            {status === "working" ? (
              <>
                <span aria-hidden className="size-1.5 rounded-full bg-info" />
                {workStartedAt ? (
                  <span>
                    Working for <WorkingTimer createdAt={workStartedAt} />
                  </span>
                ) : (
                  "Working…"
                )}
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
      <div
        className={cn(
          floating &&
            "origin-bottom motion-safe:transition-[opacity,translate,scale] motion-safe:duration-150 motion-safe:ease-out",
          !open && "translate-y-2 scale-[0.98] opacity-0 **:pointer-events-none!",
        )}
      >
        {children}
      </div>
    </div>
  );
}
