import { useEffect, useRef, useState } from "react";
import { Eye, EyeOff, KeyRound, LoaderCircle, LockKeyhole, UserRound } from "lucide-react";
import type { Profile } from "@/api";
import type { Key } from "@/i18n";
import { Button } from "@/components/ui/button";

type T = (k: Key) => string;

interface Props {
  t: T;
  profile: Profile;
  /** "both": first run (name, group code, password); "code": only the group code; "password": only the account password */
  mode: "both" | "code" | "password";
  /** the dialog cannot be dismissed (first run, or an account that still has no password) */
  required: boolean;
  /** the app has a group server; without one the code and password fields are not shown at all */
  syncConfigured: boolean;
  /** resolves to "" when saved, otherwise a message to show (the dialog stays open) */
  onSave: (name: string, code: string, password: string) => Promise<string>;
  onClose: () => void;
}

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), [href], select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function ProfileDialog({ t, profile, mode, required, syncConfigured, onSave, onClose }: Props) {
  const showName = mode === "both";
  const showCode = syncConfigured && mode !== "password";
  const showPassword = syncConfigured && mode !== "code";
  const [name, setName] = useState(profile.name || profile.suggested || "");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const first = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLDivElement>(null);

  // focus goes into the dialog and comes back to where it was; the page behind does not scroll
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    first.current?.focus(); first.current?.select();
    return () => { document.body.style.overflow = prevOverflow; before?.focus?.(); };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !required) { onClose(); return; }
      if (e.key !== "Tab" || !box.current) return;
      // Tab stays inside the dialog
      const items = [...box.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (items.length === 0) return;
      const firstEl = items[0], lastEl = items[items.length - 1];
      if (e.shiftKey && document.activeElement === firstEl) { e.preventDefault(); lastEl.focus(); }
      else if (!e.shiftKey && document.activeElement === lastEl) { e.preventDefault(); firstEl.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [required, onClose]);

  // a password is needed whenever the account is shared (a group code is typed, or the dialog is the password one)
  const passwordNeeded = showPassword && (mode === "password" || code.trim() !== "");
  const canSave =
    (showName ? name.trim() !== "" : true) &&
    (mode === "code" ? code.trim() !== "" : true) &&
    (passwordNeeded ? password.length >= 6 : true);

  const save = async () => {
    if (!canSave || busy) return;
    setBusy(true);
    setProblem("");
    try { setProblem(await onSave(showName ? name.trim() : profile.name, showCode ? code.trim() : "", showPassword ? password : "")); }
    catch { setProblem(t("errSaveCode")); }
    finally { setBusy(false); }
  };

  const Icon = mode === "password" ? LockKeyhole : showName ? UserRound : KeyRound;
  const title = mode === "password" ? t("passwordTitle") : showName ? t("profileTitle") : t("codeDialogTitle");

  const inputCls = "h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary/60";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--scrim)] p-4" role="dialog" aria-modal="true" aria-labelledby="profile-title">
      <div ref={box} className="enter max-h-full w-full max-w-md overflow-y-auto rounded-2xl border border-border bg-card p-6 shadow-2xl">
        <div className="mb-4 flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-xl bg-primary/15 text-primary"><Icon className="size-5" /></div>
          <h2 id="profile-title" className="text-base font-semibold">{title}</h2>
        </div>

        {showName && (
          <>
            <p className="mb-4 text-xs leading-relaxed text-muted-foreground">{t("profileHint")}</p>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground" htmlFor="profile-name">{t("profileName")}</label>
            <input
              id="profile-name"
              ref={first}
              value={name}
              maxLength={24}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void save(); }}
              className={inputCls}
            />
            <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">{t("nameOnce")}</p>
          </>
        )}

        {showCode && (
          <div className={showName ? "mt-5" : ""}>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground" htmlFor="group-code">{t("groupCode")}</label>
            <input
              id="group-code"
              ref={showName ? undefined : first}
              value={code}
              maxLength={80}
              dir="ltr"
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void save(); }}
              className={"num tracking-wide " + inputCls}
            />
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{t("groupCodeHint")} {mode === "both" && t("groupCodeSkip")}</p>
          </div>
        )}

        {showPassword && (
          <div className={showName || showCode ? "mt-5" : ""}>
            {mode === "password" && <p className="mb-3 text-xs leading-relaxed text-muted-foreground">{t("passwordIntro")}</p>}
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground" htmlFor="account-password">{t("password")}</label>
            <div className="relative">
              <input
                id="account-password"
                ref={showName || showCode ? undefined : first}
                type={reveal ? "text" : "password"}
                value={password}
                maxLength={100}
                dir="ltr"
                autoComplete="new-password"
                spellCheck={false}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") void save(); }}
                className={"num pe-10 " + inputCls}
              />
              <button
                type="button"
                onClick={() => setReveal((r) => !r)}
                aria-label={t(reveal ? "passwordHide" : "passwordShow")}
                className="absolute end-1 top-1 flex size-8 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                {reveal ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{t("passwordHint")}</p>
          </div>
        )}

        {problem && <p role="alert" className="mt-4 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">{problem}</p>}

        <div className="mt-5 flex justify-end gap-2">
          {!required && <Button variant="ghost" onClick={onClose}>{t("cancel2")}</Button>}
          <Button onClick={save} disabled={busy || !canSave}>
            {busy && <LoaderCircle className="animate-spin" />} {t("profileSave")}
          </Button>
        </div>
      </div>
    </div>
  );
}
