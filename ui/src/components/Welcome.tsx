import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowLeft, ArrowRight, Ban, Check, Users } from "lucide-react";
import type { Key } from "@/i18n";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/Logo";
import { LinkStrip } from "@/components/LinkStrip";
import { Flag } from "@/lib/flags";

type T = (k: Key) => string;

interface Props {
  t: T;
  rtl: boolean;
  onDone: () => void;
}

const FOCUSABLE = 'button:not([disabled])';

/** First run only: three short scenes that show what the app does with its own pictures (the same wire the results use). */
export function Welcome({ t, rtl, onDone }: Props) {
  const [step, setStep] = useState(0);
  const reduce = useReducedMotion();
  const box = useRef<HTMLDivElement>(null);
  const last = step === 2;
  const Next = rtl ? ArrowLeft : ArrowRight;

  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; before?.focus?.(); };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { onDone(); return; }
      if (e.key !== "Tab" || !box.current) return;
      const items = [...box.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (items.length === 0) return;
      const a = items[0], z = items[items.length - 1];
      if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); }
      else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onDone]);

  const scenes = [
    {
      title: t("welcome1Title"), text: t("welcome1Text"),
      art: (
        <div className="flex w-full flex-col gap-7">
          <LinkStrip avg={26} jitter={0.4} loss={0} verdict="good" youLabel={t("you")} server={<Flag country="Qatar" cc="QA" />} serverNote={t("welcomeCity1")} />
          <LinkStrip avg={115} jitter={13} loss={4} verdict="bad" youLabel={t("you")} server={<Flag country="Palestine" cc="PS" />} serverNote={t("welcomeCity2")} />
        </div>
      ),
    },
    {
      title: t("welcome2Title"), text: t("welcome2Text"),
      art: (
        <div className="flex flex-col items-center gap-5">
          <div className="relative">
            <div className="num rounded-2xl border border-border bg-card px-6 py-4 text-xl font-semibold lift sm:text-2xl">34.165.0.0/16</div>
            <motion.span
              initial={reduce ? false : { scale: 1.8, opacity: 0, rotate: -8 }}
              animate={{ scale: 1, opacity: 1, rotate: -6 }}
              transition={{ delay: 0.5, duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
              className="absolute -bottom-3 -end-3 inline-flex items-center gap-1.5 rounded-xl border-2 border-destructive bg-card px-3 py-1 text-sm font-bold text-destructive"
            >
              <Ban className="size-4" /> {t("blocked")}
            </motion.span>
          </div>
          <LinkStrip avg={null} jitter={null} loss={100} verdict="noreply" youLabel={t("you")} server={<Ban className="size-7 text-destructive" />} serverNote={t("welcomeCity2")} className="mt-3 w-full opacity-80" />
        </div>
      ),
    },
    {
      title: t("welcome3Title"), text: t("welcome3Text"),
      art: (
        <div className="flex items-end justify-center gap-6 sm:gap-10">
          {["var(--color-success)", "var(--color-info)", "var(--color-warning)"].map((c, i) => (
            <motion.div key={c} initial={reduce ? false : { y: 18, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.12 * i, duration: 0.45, ease: [0.16, 1, 0.3, 1] }} className="flex flex-col items-center gap-2">
              <span className="flex size-14 items-center justify-center rounded-full border-2 bg-card sm:size-16" style={{ borderColor: c, color: c }}><Users className="size-6" /></span>
              <span className="h-10 w-px border-s border-dashed border-border" />
            </motion.div>
          ))}
        </div>
      ),
    },
  ];
  const sc = scenes[step];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-background p-4" role="dialog" aria-modal="true" aria-labelledby="welcome-title">
      <div ref={box} className="relative mx-auto flex w-full max-w-2xl flex-col items-center gap-8 py-6 text-center">
        <div className="flex items-center gap-3">
          <Logo className="size-12" />
          <span className="text-2xl font-extrabold" dir="ltr">GameNetKit</span>
        </div>

        <div className="relative flex min-h-[15rem] w-full items-center justify-center">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={step}
              initial={reduce ? false : { opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduce ? undefined : { opacity: 0, y: -10 }}
              transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
              className="w-full"
            >
              {sc.art}
            </motion.div>
          </AnimatePresence>
        </div>

        <div className="min-h-[7.5rem]" aria-live="polite">
          <h1 id="welcome-title" className="text-2xl font-extrabold text-balance sm:text-3xl">{sc.title}</h1>
          <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-pretty text-muted-foreground sm:text-base">{sc.text}</p>
        </div>

        <div className="flex items-center gap-1.5" aria-hidden>
          {scenes.map((_, i) => <span key={i} className={cn("h-1.5 rounded-full transition-all duration-300", i === step ? "w-7 bg-primary" : "w-1.5 bg-border")} />)}
        </div>

        <div className="flex items-center gap-3">
          {step > 0 && <Button variant="ghost" onClick={() => setStep(step - 1)}>{t("welcomeBack")}</Button>}
          {!last && <Button variant="ghost" onClick={onDone}>{t("welcomeSkip")}</Button>}
          <Button size="lg" onClick={() => (last ? onDone() : setStep(step + 1))} autoFocus>
            {last ? <><Check /> {t("welcomeStart")}</> : <>{t("welcomeNext")} <Next /></>}
          </Button>
        </div>
      </div>
    </div>
  );
}
