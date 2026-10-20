import { useCallback, useEffect, useId, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ChevronDown, Loader2, SendHorizontal, X } from "lucide-react";
import { useRouterState } from "@tanstack/react-router";
import { sendChatbotMessage, submitChatbotContact } from "@/lib/api/chatbot";
import { useLanguage } from "@/lib/i18n";
import type { ChatErrorCode } from "@/lib/chatbot/types";
import {
  buildIdentity,
  enforceChatbotIdentityReset,
  loadChatbotIdentity,
  saveChatbotIdentity,
  syncIdentityEpochAfterRegistration,
  touchChatbotIdentity,
} from "@/lib/chatbot/identity";
import { validatePhone, validateVisitorName } from "@/lib/chatbot/phone";
import {
  CHATBOT_MAX_MESSAGE_LENGTH,
  getOrCreateChatSessionId,
  persistSessionId,
} from "@/lib/chatbot/session";
import { AssistantMessageContent } from "@/lib/chatbot/renderAssistantMessage";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

/** Chatbot-only captain logo — do not reuse on the rest of the site. */
const CAPTAIN_AVATAR_SRC = "/images/brand/lunayair_chatbot_captain_robot_cap_only.webp";

function CaptainAvatar({
  className,
  ring = true,
  onlineDot = false,
}: {
  className?: string;
  ring?: boolean;
  onlineDot?: boolean;
}) {
  return (
    <div
      className={cn(
        "relative shrink-0 overflow-hidden rounded-full bg-gradient-to-br from-[#0b1c33] via-[#132a4a] to-[#0a1628]",
        ring && "ring-2 ring-gold/55 ring-offset-2 ring-offset-navy/80",
        className,
      )}
    >
      <img
        src={CAPTAIN_AVATAR_SRC}
        alt=""
        width={96}
        height={96}
        className="size-full object-cover object-[center_18%]"
        draggable={false}
        decoding="async"
      />
      {onlineDot ? (
        <span
          className="absolute end-0.5 bottom-0.5 size-2.5 rounded-full border-2 border-navy bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.7)]"
          aria-hidden
        />
      ) : null}
    </div>
  );
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  error?: boolean;
}

interface QuickReply {
  label: string;
  message: string;
}

type OnboardingStep = "welcome" | "form";

function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? fullName.trim();
}

function formatPersonalWelcome(
  t: (key: string) => string,
  visitorName: string,
  isReturning: boolean,
): string {
  const key = isReturning ? "chatbot.returningWelcome" : "chatbot.registeredWelcome";
  return t(key).replace("{{name}}", firstName(visitorName));
}

function createMessageId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function formatTime(date: Date, language: "en" | "ar"): string {
  return new Intl.DateTimeFormat(language === "ar" ? "ar-SA" : "en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function isPhoneLikeViewport(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(max-width: 640px), (pointer: coarse)").matches;
}

type AudioContextConstructor = typeof AudioContext;

let messageAudioContext: AudioContext | null = null;

function getMessageAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const AC =
    window.AudioContext ??
    (window as Window & { webkitAudioContext?: AudioContextConstructor }).webkitAudioContext;
  if (!AC) return null;
  if (!messageAudioContext) {
    try {
      messageAudioContext = new AC();
    } catch {
      return null;
    }
  }
  return messageAudioContext;
}

function playTone(
  ctx: AudioContext,
  freq: number,
  start: number,
  duration: number,
  volume: number,
) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(freq, start);
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(volume, start + 0.012);
  gain.gain.linearRampToValueAtTime(volume * 0.55, start + duration * 0.4);
  gain.gain.linearRampToValueAtTime(0, start + duration);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(start);
  osc.stop(start + duration + 0.02);
}

/** Louder dual “new message” chimes (one per teaser bubble). */
async function playMessagePopSound(): Promise<boolean> {
  try {
    const ctx = getMessageAudioContext();
    if (!ctx) return false;
    if (ctx.state === "suspended") {
      await ctx.resume();
    }
    if (ctx.state !== "running") return false;

    const now = ctx.currentTime;
    // First bubble
    playTone(ctx, 988, now, 0.15, 0.28);
    playTone(ctx, 1319, now + 0.08, 0.18, 0.22);
    // Second bubble
    playTone(ctx, 988, now + 0.32, 0.15, 0.26);
    playTone(ctx, 1319, now + 0.4, 0.18, 0.2);
    return true;
  } catch {
    return false;
  }
}

function deriveFollowUpReplies(
  messages: ChatMessage[],
  t: (key: string) => string,
): QuickReply[] {
  const last = messages[messages.length - 1];
  if (!last || last.role !== "assistant" || last.error) return [];

  const content = last.content;
  const hasWhatsApp = /wa\.me|api\.whatsapp\.com/i.test(content);
  const mentionsPrice = /(?:سعر|بكم|تكلف|باقة|price|cost|quote|package|pricing)/i.test(content);

  const chips: QuickReply[] = [
    {
      label: t("chatbot.followUp.moreDetails"),
      message: t("chatbot.followUp.moreDetailsMessage"),
    },
  ];

  if (!mentionsPrice) {
    chips.push({
      label: t("chatbot.followUp.pricing"),
      message: t("chatbot.followUp.pricingMessage"),
    });
  }

  if (!hasWhatsApp) {
    chips.push({
      label: t("chatbot.followUp.whatsapp"),
      message: t("chatbot.followUp.whatsappMessage"),
    });
  }

  chips.push({
    label: t("chatbot.followUp.book"),
    message: t("chatbot.followUp.bookMessage"),
  });

  return chips.slice(0, 3);
}

export function ChatbotWidget() {
  const { t, tv, language, isRTL } = useLanguage();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const isHome = pathname === "/" || pathname === "";
  const panelId = useId();
  const titleId = `${panelId}-title`;
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fabRef = useRef<HTMLButtonElement>(null);
  const stickToBottomRef = useRef(true);
  const lastUserMessageRef = useRef<string | null>(null);
  const teaserSoundPlayedRef = useRef(false);
  const pendingTeaserSoundRef = useRef(false);

  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sessionId, setSessionId] = useState("");
  const [chatReady, setChatReady] = useState(false);
  // Welcome teasers: replay every time the visitor enters the homepage.
  const [teasersVisible, setTeasersVisible] = useState(false);
  const [teaserDismissed, setTeaserDismissed] = useState(false);
  const [badgeCleared, setBadgeCleared] = useState(false);
  const [contactSaved, setContactSaved] = useState(false);
  const [onboardingStep, setOnboardingStep] = useState<OnboardingStep>("welcome");
  const [visitorName, setVisitorName] = useState("");
  const [isReturningUser, setIsReturningUser] = useState(false);
  const [contactName, setContactName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [contactSaving, setContactSaving] = useState(false);
  const [contactError, setContactError] = useState("");
  const [contactWarning, setContactWarning] = useState("");
  const [showScrollDown, setShowScrollDown] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    void (async () => {
      await enforceChatbotIdentityReset();
      setSessionId(getOrCreateChatSessionId());
      const identity = loadChatbotIdentity();
      if (identity) {
        setContactSaved(true);
        setVisitorName(identity.name);
        setIsReturningUser(true);
        touchChatbotIdentity();
      }
      setChatReady(true);
    })();
  }, []);

  const quickReplies = tv<QuickReply[]>("chatbot.quickReplies");
  const followUpReplies = deriveFollowUpReplies(messages, t);
  const teaserMessages = tv<string[]>("chatbot.teasers") ?? [];
  const showQuickReplies = contactSaved && messages.length === 0 && !sending;
  const showFollowUpChips = contactSaved && followUpReplies.length > 0 && !sending;
  const showTeasers =
    isHome && !open && !teaserDismissed && teasersVisible && teaserMessages.length > 0;
  // After teaser bubbles hide on home, keep "2" on the FAB until chat opens (this visit).
  const showAttentionBadge =
    isHome && !open && !badgeCleared && teaserDismissed && teaserMessages.length > 0;

  useEffect(() => {
    if (!isHome) {
      setTeasersVisible(false);
      setTeaserDismissed(true);
      return;
    }
    // Fresh homepage visit — show welcome bubbles again.
    teaserSoundPlayedRef.current = false;
    pendingTeaserSoundRef.current = false;
    setBadgeCleared(false);
    setTeaserDismissed(false);
    setTeasersVisible(true);
  }, [isHome]);

  // Browsers block autoplay: unlock AudioContext on first gesture, then play pending chime.
  useEffect(() => {
    const tryUnlockAndPlay = () => {
      void (async () => {
        const ctx = getMessageAudioContext();
        if (ctx?.state === "suspended") {
          try {
            await ctx.resume();
          } catch {
            // ignore
          }
        }
        if (!pendingTeaserSoundRef.current || teaserSoundPlayedRef.current) return;
        if (await playMessagePopSound()) {
          teaserSoundPlayedRef.current = true;
          pendingTeaserSoundRef.current = false;
        }
      })();
    };

    const opts: AddEventListenerOptions = { capture: true };
    window.addEventListener("pointerdown", tryUnlockAndPlay, opts);
    window.addEventListener("touchstart", tryUnlockAndPlay, opts);
    window.addEventListener("keydown", tryUnlockAndPlay, opts);
    return () => {
      window.removeEventListener("pointerdown", tryUnlockAndPlay, opts);
      window.removeEventListener("touchstart", tryUnlockAndPlay, opts);
      window.removeEventListener("keydown", tryUnlockAndPlay, opts);
    };
  }, []);

  // Fire (or queue) attention chime when teaser bubbles appear.
  useEffect(() => {
    if (!teasersVisible || teaserDismissed || open || teaserSoundPlayedRef.current) return;
    pendingTeaserSoundRef.current = true;

    let cancelled = false;
    void (async () => {
      await new Promise((r) => window.setTimeout(r, 120));
      if (cancelled || teaserSoundPlayedRef.current) return;
      if (await playMessagePopSound()) {
        teaserSoundPlayedRef.current = true;
        pendingTeaserSoundRef.current = false;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [teasersVisible, teaserDismissed, open]);

  // Keep welcome bubbles ~6s, then leave the "2" badge until chat opens.
  useEffect(() => {
    if (!teasersVisible || teaserDismissed || open) return;
    const timer = window.setTimeout(() => {
      setTeasersVisible(false);
      setTeaserDismissed(true);
      pendingTeaserSoundRef.current = false;
    }, 6_000);
    return () => window.clearTimeout(timer);
  }, [teasersVisible, teaserDismissed, open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        fabRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  useEffect(() => {
    if (open) {
      if (!isPhoneLikeViewport()) {
        window.setTimeout(() => inputRef.current?.focus(), 120);
      }
    }
  }, [open]);

  useEffect(() => {
    if (isPhoneLikeViewport()) {
      document.body.style.overflow = "";
      return;
    }
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    messagesEndRef.current?.scrollIntoView({ behavior, block: "end" });
  }, []);

  useEffect(() => {
    if (stickToBottomRef.current) {
      scrollToBottom(messages.length <= 1 ? "auto" : "smooth");
    }
    window.requestAnimationFrame(() => handleScroll());
  }, [messages, sending, scrollToBottom]);

  const handleScroll = () => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const distanceFromBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight;
    stickToBottomRef.current = distanceFromBottom < 72;
    setShowScrollDown(distanceFromBottom >= 96);
  };

  const resolveErrorMessage = useCallback(
    (code: ChatErrorCode): string => {
      if (code === "RATE_LIMIT") return t("chatbot.rateLimit");
      if (code === "TIMEOUT") return t("chatbot.timeout");
      if (code === "GEMINI" || code === "AI" || code === "CONTEXT" || code === "CONFIG") return t("chatbot.aiUnavailable");
      if (code === "VALIDATION") return t("chatbot.validation");
      return t("chatbot.error");
    },
    [t],
  );

  const submitMessage = useCallback(
    async (rawMessage: string) => {
      const message = rawMessage.trim();
      if (!chatReady || !sessionId || !contactSaved || !message || sending || message.length > CHATBOT_MAX_MESSAGE_LENGTH) return;

      lastUserMessageRef.current = message;
      stickToBottomRef.current = true;

      const userMessage: ChatMessage = {
        id: createMessageId(),
        role: "user",
        content: message,
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, userMessage]);
      setInput("");
      setSending(true);

      try {
        const response = await sendChatbotMessage({
          data: {
            message,
            language,
            sessionId,
          },
        });

        if (response.ok) {
          setMessages((prev) => [
            ...prev,
            {
              id: createMessageId(),
              role: "assistant",
              content: response.reply,
              timestamp: new Date(),
            },
          ]);
          if (!open) {
            setUnreadCount((count) => count + 1);
          } else {
            void playMessagePopSound();
          }
        } else {
          setMessages((prev) => [
            ...prev,
            {
              id: createMessageId(),
              role: "assistant",
              content: resolveErrorMessage(response.code),
              timestamp: new Date(),
              error: true,
            },
          ]);
        }
      } catch {
        setMessages((prev) => [
          ...prev,
          {
            id: createMessageId(),
            role: "assistant",
            content: t("chatbot.error"),
            timestamp: new Date(),
            error: true,
          },
        ]);
      } finally {
        setSending(false);
      }
    },
    [chatReady, contactSaved, language, open, resolveErrorMessage, sending, sessionId, t],
  );

  const handleSubmit = (event?: React.FormEvent) => {
    event?.preventDefault();
    void submitMessage(input);
  };

  const handleContactSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const name = contactName.trim();
    const phone = contactPhone.trim();
    if (!sessionId || !validateVisitorName(name) || !validatePhone(phone) || contactSaving) return;

    setContactSaving(true);
    setContactError("");
    setContactWarning("");

    const identity = buildIdentity({ sessionId, name, phone, language });
    saveChatbotIdentity(identity);
    persistSessionId(sessionId, name, phone, language);
    await syncIdentityEpochAfterRegistration();

    try {
      const result = await submitChatbotContact({
        data: {
          sessionId,
          language,
          name,
          phone,
        },
      });
      if (!result.ok) {
        setContactWarning(t("chatbot.contactSyncPending"));
      }
      setContactSaved(true);
      setVisitorName(name);
      setIsReturningUser(false);
      setMessages([
        {
          id: createMessageId(),
          role: "assistant",
          content: result.ok
            ? result.confirmation
            : formatPersonalWelcome(t, name, false),
          timestamp: new Date(),
        },
      ]);
      setContactName("");
      setContactPhone("");
    } catch {
      setContactWarning(t("chatbot.contactSyncPending"));
      setContactSaved(true);
      setVisitorName(name);
      setIsReturningUser(false);
      setMessages([
        {
          id: createMessageId(),
          role: "assistant",
          content: formatPersonalWelcome(t, name, false),
          timestamp: new Date(),
        },
      ]);
    } finally {
      setContactSaving(false);
    }
  };

  const handleInputKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleSubmit();
    }
  };

  const handleRetry = () => {
    if (lastUserMessageRef.current) {
      void submitMessage(lastUserMessageRef.current);
    }
  };

  // Physical left/right only — never start/end (RTL maps end→left and stretches the FAB row).
  const cornerPosition = isRTL
    ? "left-auto right-3 sm:right-7"
    : "right-auto left-3 sm:left-7";

  const openChat = () => {
    setTeaserDismissed(true);
    setTeasersVisible(false);
    setBadgeCleared(true);
    setUnreadCount(0);
    setOpen(true);
  };

  const teaserBubbles = showTeasers ? (
    <motion.div
      key="chat-teasers"
      role="region"
      aria-label={t("chatbot.teaserAria")}
      initial={{ opacity: 0, x: isRTL ? 12 : -12 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: isRTL ? 8 : -8, transition: { duration: 0.28 } }}
      className={cn(
        "flex w-[min(15.5rem,calc(100vw-5.5rem))] flex-col gap-2",
        isRTL ? "items-end" : "items-start",
      )}
    >
      {teaserMessages.map((text, index) => (
        <motion.button
          key={`${index}-${text.slice(0, 24)}`}
          type="button"
          onClick={openChat}
          initial={{ opacity: 0, x: isRTL ? 14 : -14, scale: 0.97 }}
          animate={{ opacity: 1, x: 0, scale: 1 }}
          transition={{
            delay: 0.2 + index * 0.75,
            duration: 0.4,
            ease: [0.22, 1, 0.36, 1],
          }}
          className={cn(
            "w-full rounded-2xl border border-navy/8 bg-white px-3.5 py-2.5 text-start text-sm leading-snug text-navy shadow-[0_10px_28px_rgba(15,23,42,0.14)] transition hover:-translate-y-0.5 hover:border-gold/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold",
            isRTL ? "text-right rounded-ee-md" : "text-left rounded-es-md",
          )}
        >
          {text}
        </motion.button>
      ))}
    </motion.div>
  ) : null;

  return (
    <div
      className={cn(
        // Homepage phone: sit just above the red ad strip (min-h-12 ≈ 3rem).
        "fixed z-50 flex flex-col gap-2.5",
        isHome
          ? "bottom-[calc(3.25rem+env(safe-area-inset-bottom))] sm:bottom-[calc(5.25rem+env(safe-area-inset-bottom))]"
          : "bottom-[max(1rem,env(safe-area-inset-bottom))] sm:bottom-[max(1.5rem,env(safe-area-inset-bottom))]",
        cornerPosition,
      )}
    >
      <AnimatePresence>
        {open ? (
          <motion.section
            key="chat-panel"
            id={panelId}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className={cn(
              "flex flex-col overflow-hidden rounded-[1.65rem] border border-white/10 bg-[#f3f6fa] shadow-[0_28px_64px_rgba(8,18,36,0.38),0_0_0_1px_rgba(212,175,55,0.12)]",
              // Desktop: slender tall card beside the FAB
              "sm:w-[min(100vw-2.5rem,23rem)]",
              // Mobile: narrower centered column, stretch tall between nav and FAB
              "max-sm:fixed max-sm:left-1/2 max-sm:z-50 max-sm:w-[min(20.5rem,calc(100vw-3.5rem))] max-sm:-translate-x-1/2 max-sm:h-auto",
              isHome
                ? "max-sm:top-[calc(3.35rem+env(safe-area-inset-top))] max-sm:bottom-[calc(3.25rem+env(safe-area-inset-bottom))] sm:h-[min(42rem,calc(100dvh-8.5rem))]"
                : "max-sm:top-[calc(3.35rem+env(safe-area-inset-top))] max-sm:bottom-[calc(3.65rem+env(safe-area-inset-bottom))] sm:h-[min(42rem,calc(100dvh-7rem))]",
            )}
          >
            <header className="relative shrink-0 overflow-hidden bg-navy px-3.5 pb-3.5 pt-3.5 text-navy-foreground sm:px-4 sm:pb-4 sm:pt-4">
              <div
                className="pointer-events-none absolute inset-0"
                style={{
                  background:
                    "radial-gradient(ellipse 90% 140% at 0% 0%, color-mix(in oklab, var(--gold) 28%, transparent), transparent 52%), radial-gradient(ellipse 70% 100% at 100% 120%, color-mix(in oklab, var(--ocean) 45%, transparent), transparent 50%), linear-gradient(155deg, #0c1f38 0%, var(--navy) 48%, #071221 100%)",
                }}
                aria-hidden
              />
              <div
                className="pointer-events-none absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-gold/60 to-transparent"
                aria-hidden
              />
              <div className={cn("relative flex items-center gap-3 sm:gap-3.5", isRTL && "pe-11 sm:pe-12")}>
                <CaptainAvatar className="size-12 sm:size-[3.25rem]" onlineDot />
                <div className="min-w-0 flex-1">
                  <h2
                    id={titleId}
                    className="truncate font-display text-[1.02rem] leading-tight tracking-wide text-white sm:text-[1.12rem]"
                  >
                    {t("chatbot.title")}
                  </h2>
                  <p className="mt-1 flex items-center gap-1.5 text-[0.7rem] text-gold/95 sm:text-[0.72rem]">
                    <span className="relative flex size-1.5">
                      <span className="absolute inset-0 animate-ping rounded-full bg-emerald-400/70" aria-hidden />
                      <span className="relative size-1.5 rounded-full bg-emerald-400" aria-hidden />
                    </span>
                    {t("chatbot.statusOnline")}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    fabRef.current?.focus();
                  }}
                  aria-label={t("common.close")}
                  className={cn(
                    "grid size-8 shrink-0 place-items-center rounded-full border border-white/15 bg-white/8 text-white/90 transition hover:border-gold/55 hover:bg-white/12 hover:text-gold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold sm:size-9",
                    isRTL && "absolute end-0 top-1/2 -translate-y-1/2",
                  )}
                >
                  <X className="size-4" strokeWidth={1.75} />
                </button>
              </div>
              <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-gold/45 to-transparent" aria-hidden />
            </header>

            {!contactSaved ? (
              onboardingStep === "welcome" ? (
                <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-5 py-6">
                  <CaptainAvatar className="size-20 ring-offset-[#f3f6fa] sm:size-24" ring />
                  <p className="mt-4 text-center font-display text-[1.05rem] text-navy">
                    {t("chatbot.title")}
                  </p>
                  <p className="mt-2 text-center text-sm leading-relaxed text-navy/75 whitespace-pre-line">
                    {t("chatbot.welcome")}
                  </p>
                  <p className="mt-3 text-center text-[0.75rem] leading-snug text-navy/55">
                    {t("chatbot.contactHint")}
                  </p>
                  <p className="mt-1.5 text-center text-[0.7rem] leading-snug text-navy/45">
                    {t("chatbot.contactGate")}
                  </p>
                  <Button
                    type="button"
                    onClick={() => setOnboardingStep("form")}
                    className="mt-5 h-11 w-full rounded-2xl border border-gold bg-gold text-navy shadow-[0_10px_28px_rgba(212,175,55,0.28)] hover:bg-gold-soft"
                  >
                    {t("chatbot.startChatButton")}
                  </Button>
                </div>
              ) : (
              <div className="flex min-h-0 flex-1 flex-col justify-center px-4 py-5">
                <div className="mb-3 flex justify-center">
                  <CaptainAvatar className="size-16 ring-offset-[#f3f6fa]" ring />
                </div>
                <p className="text-center text-sm leading-relaxed text-navy/80">
                  {t("chatbot.welcome")}
                </p>
                <form
                  onSubmit={(event) => void handleContactSubmit(event)}
                  className="mt-4 rounded-2xl border border-gold/25 bg-gradient-to-b from-white to-[#f7fafc] p-3.5 shadow-[0_12px_32px_rgba(15,23,42,0.08)]"
                >
                  <p className="text-center text-[0.8rem] font-medium text-navy">
                    {t("chatbot.contactTitle")}
                  </p>
                  <p className="mt-1 text-center text-[0.7rem] leading-snug text-navy/55">
                    {t("chatbot.contactHint")}
                  </p>
                  <div className="mt-3 space-y-2">
                    <Input
                      value={contactName}
                      onChange={(event) => setContactName(event.target.value.slice(0, 120))}
                      placeholder={t("chatbot.contactName")}
                      autoComplete="name"
                      disabled={contactSaving}
                      dir={isRTL ? "rtl" : "ltr"}
                      className="h-11 border-navy/12 bg-white text-base sm:text-sm"
                      aria-label={t("chatbot.contactName")}
                      autoFocus
                    />
                    <Input
                      value={contactPhone}
                      onChange={(event) => setContactPhone(event.target.value.slice(0, 40))}
                      placeholder={t("chatbot.contactPhone")}
                      autoComplete="tel"
                      inputMode="tel"
                      disabled={contactSaving}
                      dir="ltr"
                      className="h-11 border-navy/12 bg-white text-base sm:text-sm"
                      aria-label={t("chatbot.contactPhone")}
                    />
                  </div>
                  {contactError ? (
                    <p className="mt-2 text-center text-[0.68rem] text-red-600">{contactError}</p>
                  ) : (
                    <p className="mt-2 text-center text-[0.65rem] text-navy/45">{t("chatbot.contactGate")}</p>
                  )}
                  <Button
                    type="submit"
                    disabled={
                      contactSaving ||
                      !validateVisitorName(contactName.trim()) ||
                      !validatePhone(contactPhone.trim())
                    }
                    className="mt-3 h-10 w-full rounded-xl border border-gold bg-gold text-navy hover:bg-gold-soft disabled:opacity-40"
                  >
                    {contactSaving ? (
                      <Loader2 className="size-4 animate-spin" aria-hidden />
                    ) : (
                      t("chatbot.contactSubmit")
                    )}
                  </Button>
                </form>
              </div>
              )
            ) : (
              <>
            <div className="relative flex min-h-0 flex-1 flex-col">
            <div
              ref={scrollContainerRef}
              onScroll={handleScroll}
              className="min-h-0 flex-1 space-y-3.5 overflow-x-hidden overflow-y-auto px-3 py-4 sm:space-y-4 sm:px-3.5 sm:py-4"
              style={{
                background:
                  "radial-gradient(ellipse 120% 60% at 50% -10%, color-mix(in oklab, var(--gold) 10%, transparent), transparent 55%), linear-gradient(180deg, #eef3f8 0%, #f5f7fa 42%, #e8eef5 100%)",
              }}
              aria-live="polite"
              aria-relevant="additions"
            >
              <div
                className={cn(
                  "flex max-w-[min(94%,100%)] items-end gap-2",
                  isRTL ? "ms-auto me-0 flex-row" : "me-auto ms-0 flex-row",
                )}
              >
                <CaptainAvatar className="mb-5 size-8 ring-1 ring-gold/40 ring-offset-0" ring={false} />
                <div className="min-w-0">
                  <div
                    className={cn(
                      "min-w-0 break-words rounded-2xl border border-navy/8 bg-white px-3.5 py-2.5 text-[0.8125rem] leading-relaxed text-navy shadow-[0_10px_28px_rgba(15,23,42,0.07)] [overflow-wrap:anywhere] sm:text-sm",
                      isRTL ? "rounded-es-md" : "rounded-ee-md",
                    )}
                  >
                    <p className="whitespace-pre-line break-words [overflow-wrap:anywhere]">
                      {visitorName
                        ? formatPersonalWelcome(t, visitorName, isReturningUser && messages.length === 0)
                        : t("chatbot.welcome")}
                    </p>
                  </div>
                  <time
                    className="mt-1.5 block px-1 text-[0.62rem] text-navy/40"
                    dateTime={new Date().toISOString()}
                  >
                    {formatTime(new Date(), language)}
                  </time>
                </div>
              </div>

              {showQuickReplies ? (
                <div
                  className={cn(
                    "flex max-w-full flex-wrap gap-1.5 sm:max-w-[95%] sm:gap-2",
                    isRTL ? "ms-auto me-0 justify-end" : "me-auto ms-0 justify-start",
                  )}
                >
                  {quickReplies.map((reply) => (
                    <button
                      key={reply.label}
                      type="button"
                      onClick={() => void submitMessage(reply.message)}
                      className="rounded-full border border-navy/10 bg-white/80 px-2.5 py-1.5 text-[0.7rem] text-navy/85 shadow-sm backdrop-blur-sm transition hover:border-gold/55 hover:bg-gold/10 hover:text-navy focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold sm:px-3 sm:text-xs"
                    >
                      {reply.label}
                    </button>
                  ))}
                </div>
              ) : null}

              {messages.map((message) => (
                <div
                  key={message.id}
                  className={cn(
                    "flex w-full max-w-[min(94%,100%)] min-w-0 flex-col gap-1",
                    message.role === "user"
                      ? isRTL
                        ? "ms-0 me-auto items-start"
                        : "me-0 ms-auto items-end"
                      : isRTL
                        ? "ms-auto me-0 items-stretch"
                        : "me-auto ms-0 items-stretch",
                  )}
                >
                  <div
                    className={cn(
                      "flex items-end gap-2",
                      message.role === "assistant" && (isRTL ? "flex-row" : "flex-row"),
                      message.role === "user" && "w-full justify-end",
                    )}
                  >
                    {message.role === "assistant" ? (
                      <CaptainAvatar className="mb-5 size-7 ring-1 ring-gold/35 ring-offset-0" ring={false} />
                    ) : null}
                    <div
                      className={cn(
                        "min-w-0 max-w-full break-words rounded-2xl px-3.5 py-2.5 text-[0.8125rem] leading-relaxed [overflow-wrap:anywhere] sm:text-sm",
                        message.role === "user"
                          ? "rounded-es-md bg-gradient-to-br from-navy to-[#132a4a] text-navy-foreground shadow-[0_12px_30px_rgba(15,23,42,0.22)]"
                          : message.error
                            ? "rounded-ee-md border border-red-200 bg-red-50 text-red-900"
                            : "rounded-ee-md border border-navy/8 bg-white text-navy shadow-[0_10px_28px_rgba(15,23,42,0.07)]",
                        message.role === "user" && isRTL && "rounded-es-2xl rounded-ee-md",
                        message.role === "assistant" && isRTL && "rounded-ee-2xl rounded-es-md",
                      )}
                    >
                      {message.role === "assistant" && !message.error ? (
                        <AssistantMessageContent content={message.content} />
                      ) : (
                        <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{message.content}</p>
                      )}
                    </div>
                  </div>
                  <div
                    className={cn(
                      "flex items-center gap-2 px-1",
                      message.role === "assistant" && (isRTL ? "pe-9" : "ps-9"),
                    )}
                  >
                    <time
                      className="text-[0.65rem] text-navy/40"
                      dateTime={message.timestamp.toISOString()}
                    >
                      {formatTime(message.timestamp, language)}
                    </time>
                    {message.error ? (
                      <button
                        type="button"
                        onClick={handleRetry}
                        className="text-[0.65rem] font-medium text-navy underline-offset-2 hover:text-gold hover:underline"
                      >
                        {t("chatbot.retry")}
                      </button>
                    ) : null}
                  </div>
                </div>
              ))}

              {showFollowUpChips ? (
                <div
                  className={cn(
                    "flex max-w-full flex-wrap gap-1.5 sm:max-w-[95%] sm:gap-2",
                    isRTL ? "ms-auto me-0 justify-end" : "me-auto ms-0 justify-start",
                  )}
                >
                  {followUpReplies.map((reply) => (
                    <button
                      key={reply.label}
                      type="button"
                      onClick={() => void submitMessage(reply.message)}
                      className="rounded-full border border-gold/35 bg-gold/12 px-2.5 py-1.5 text-[0.7rem] font-medium text-navy shadow-sm transition hover:border-gold/60 hover:bg-gold/22 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold sm:px-3 sm:text-xs"
                    >
                      {reply.label}
                    </button>
                  ))}
                </div>
              ) : null}

              {sending ? (
                <div
                  className={cn(
                    "flex max-w-[90%] items-end gap-2",
                    isRTL ? "ms-auto me-0" : "me-auto ms-0",
                  )}
                  role="status"
                  aria-label={t("chatbot.typing")}
                >
                  <CaptainAvatar className="size-7 ring-1 ring-gold/35 ring-offset-0" ring={false} />
                  <div className="flex items-center gap-2.5 rounded-2xl rounded-ee-md border border-navy/8 bg-white px-3.5 py-3 text-sm text-navy/65 shadow-[0_10px_28px_rgba(15,23,42,0.07)]">
                    <span className="flex items-center gap-1" aria-hidden>
                      <span className="size-1.5 animate-bounce rounded-full bg-gold [animation-delay:-0.2s]" />
                      <span className="size-1.5 animate-bounce rounded-full bg-gold [animation-delay:-0.1s]" />
                      <span className="size-1.5 animate-bounce rounded-full bg-gold" />
                    </span>
                    <span className="text-xs">{t("chatbot.typing")}…</span>
                  </div>
                </div>
              ) : null}

              <div ref={messagesEndRef} />
            </div>

            <AnimatePresence>
              {showScrollDown ? (
                <motion.button
                  key="scroll-latest"
                  type="button"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 8 }}
                  transition={{ duration: 0.18 }}
                  onClick={() => {
                    stickToBottomRef.current = true;
                    scrollToBottom();
                    setShowScrollDown(false);
                  }}
                  aria-label={t("chatbot.scrollToLatest")}
                  className={cn(
                    "absolute bottom-3 z-10 inline-flex items-center gap-1 rounded-full border border-navy/10 bg-white/95 px-2.5 py-1.5 text-[0.65rem] font-medium text-navy shadow-[0_8px_24px_rgba(15,23,42,0.14)] backdrop-blur-sm transition hover:border-gold/45 hover:text-gold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold sm:bottom-4 sm:px-3 sm:text-xs",
                    isRTL ? "left-1/2 -translate-x-1/2" : "left-1/2 -translate-x-1/2",
                  )}
                >
                  <ChevronDown className="size-3.5 shrink-0" aria-hidden />
                  {t("chatbot.scrollToLatest")}
                </motion.button>
              ) : null}
            </AnimatePresence>
            </div>

            <form
              onSubmit={handleSubmit}
              className="shrink-0 border-t border-navy/8 bg-white/95 px-2.5 py-2.5 backdrop-blur-md sm:px-3 sm:py-3"
            >
              {contactWarning ? (
                <p className="mb-2 text-center text-[0.65rem] text-amber-700">{contactWarning}</p>
              ) : null}
              <div className="flex items-end gap-1.5 rounded-2xl border border-navy/10 bg-[#eef2f7] p-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.85)] focus-within:border-gold/50 focus-within:bg-white focus-within:ring-2 focus-within:ring-gold/20 sm:gap-2 sm:p-1.5">
                <Textarea
                  ref={inputRef}
                  value={input}
                  onChange={(event) =>
                    setInput(event.target.value.slice(0, CHATBOT_MAX_MESSAGE_LENGTH))
                  }
                  onKeyDown={handleInputKeyDown}
                  placeholder={t("chatbot.placeholder")}
                  rows={1}
                  disabled={sending}
                  dir={isRTL ? "rtl" : "ltr"}
                  aria-label={t("chatbot.placeholder")}
                  className="min-h-9 max-h-28 flex-1 resize-none border-0 bg-transparent px-2 py-2 text-base shadow-none focus-visible:ring-0 sm:min-h-10 sm:px-2.5 sm:py-2.5 sm:text-sm"
                />
                <Button
                  type="submit"
                  size="icon"
                  disabled={sending || !input.trim()}
                  aria-label={t("chatbot.send")}
                  className="size-9 shrink-0 rounded-xl border border-gold/70 bg-gold text-navy transition hover:bg-gold-soft disabled:border-navy/15 disabled:bg-navy/25 disabled:text-white/70 sm:size-10"
                >
                  {sending ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                  ) : (
                    <SendHorizontal className={cn("size-4", isRTL && "scale-x-[-1]")} />
                  )}
                </Button>
              </div>
            </form>
              </>
            )}
          </motion.section>
        ) : null}
      </AnimatePresence>

      {/*
        dir=ltr keeps physical order: Arabic → bubbles left of FAB (FAB on right),
        English → bubbles right of FAB (FAB on left).
      */}
      <div className="flex flex-row items-end gap-2.5" dir="ltr">
        {isRTL ? <AnimatePresence>{teaserBubbles}</AnimatePresence> : null}

        <div className={cn("relative shrink-0", open && "hidden")}>
          {!open ? (
            <>
              <span
                className="pointer-events-none absolute -inset-1.5 -z-10 rounded-full bg-gold/25 blur-md animate-pulse"
                aria-hidden
              />
              <span
                className="pointer-events-none absolute -inset-2.5 -z-20 rounded-full border border-gold/35 animate-ping opacity-75 [animation-duration:2.4s]"
                aria-hidden
              />
            </>
          ) : null}

          <AnimatePresence>
            {unreadCount > 0 && !open ? (
              <motion.span
                key="unread-badge"
                initial={{ scale: 0.6, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.6, opacity: 0 }}
                className={cn(
                  "pointer-events-none absolute z-10 grid min-w-5 place-items-center rounded-full bg-red-500 px-1 text-[0.65rem] font-semibold text-white shadow-sm ring-2 ring-white/90",
                  unreadCount > 9 ? "size-6" : "size-5",
                  isRTL ? "-top-0.5 -left-0.5" : "-top-0.5 -right-0.5",
                )}
                aria-label={t("chatbot.unreadBadge")}
              >
                {unreadCount > 9 ? "9+" : unreadCount}
              </motion.span>
            ) : showAttentionBadge ? (
              <motion.span
                key="teaser-badge"
                initial={{ scale: 0.6, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.6, opacity: 0 }}
                className={cn(
                  "pointer-events-none absolute z-10 grid size-5 place-items-center rounded-full bg-red-500 text-[0.65rem] font-semibold text-white shadow-sm ring-2 ring-white/90",
                  isRTL ? "-top-0.5 -left-0.5" : "-top-0.5 -right-0.5",
                )}
                aria-hidden
              >
                {teaserMessages.length}
              </motion.span>
            ) : null}
          </AnimatePresence>

          {showTeasers ? (
            <span
              className="pointer-events-none absolute inset-0 -z-10 animate-ping rounded-full bg-gold/40"
              aria-hidden
            />
          ) : null}

          <motion.button
            ref={fabRef}
            type="button"
            onClick={() => {
              // Ensure chime can unlock on the same tap that opens chat.
              if (pendingTeaserSoundRef.current && !teaserSoundPlayedRef.current) {
                void playMessagePopSound().then((ok) => {
                  if (ok) {
                    teaserSoundPlayedRef.current = true;
                    pendingTeaserSoundRef.current = false;
                  }
                });
              }
              if (open) {
                setOpen(false);
                return;
              }
              openChat();
            }}
            aria-label={t("chatbot.fabLabel")}
            aria-expanded={open}
            aria-controls={open ? panelId : undefined}
            whileHover={{ y: -2, scale: 1.04 }}
            whileTap={{ scale: 0.97 }}
            className={cn(
              "relative inline-flex size-14 items-center justify-center overflow-hidden rounded-full sm:size-[3.75rem]",
              "border-2 border-gold bg-navy text-navy shadow-[0_14px_36px_rgba(15,23,42,0.34),0_0_0_4px_rgba(212,175,55,0.22)]",
              "transition-shadow hover:shadow-[0_16px_40px_rgba(15,23,42,0.38),0_0_0_5px_rgba(212,175,55,0.3)]",
              "focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-gold",
            )}
          >
            <img
              src={CAPTAIN_AVATAR_SRC}
              alt=""
              width={60}
              height={60}
              className="size-full object-cover object-[center_18%]"
              draggable={false}
              decoding="async"
            />
          </motion.button>
        </div>

        {!isRTL ? <AnimatePresence>{teaserBubbles}</AnimatePresence> : null}
      </div>
    </div>
  );
}
