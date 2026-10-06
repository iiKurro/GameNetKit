import { useEffect, useRef, useState } from "react";
import { KeyRound, UserRound } from "lucide-react";
import type { Profile } from "@/api";
import type { Key } from "@/i18n";
import { Button } from "@/components/ui/button";

type T = (k: Key) => string;

interface Props {
  t: T;
  profile: Profile;
  /** "name": only the name; "code": only the group code; "both": first run */
  mode: "name" | "code" | "both";
  /** first run: there is no name yet, so the dialog cannot be dismissed */
  required: boolean;
  /** the app has a group server; without one the code field is not shown at all */
  syncConfigured: boolean;
  onSave: (name: string, code: string) => Promise<void>;
  onClose: () => void;
}

export function ProfileDialog({ t, profile, mode, required, syncConfigured, onSave, onClose }: Props) {
  const showName = mode !== "code";
  const showCode = syncConfigured && mode !== "name";
  const [name, setName] = useState(profile.name || profile.suggested || "");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const first = useRef<HTMLInputElement>(null);

  useEffect(() => { first.current?.focus(); first.current?.select(); }, []);
  useEffect(() => {
    if (required) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [required, onClose]);

  const canSave = (showName ? name.trim() !== "" : true) && (mode === "code" ? code.trim() !== "" : true);

  const save = async () => {
    if (!canSave) return;
    setBusy(true);
    try { await onSave(showName ? name.trim() : profile.name, showCode ? code.trim() : ""); } finally { setBusy(false); }
  };

  const Icon = showName ? UserRound : KeyRound;
  const title = showName ? t("profileTitle") : t("codeDialogTitle");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4" role="dialog" aria-modal="true" aria-labelledby="profile-title">
      <div className="enter w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-2xl">
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
              className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
            />
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
              className="num h-10 w-full rounded-lg border border-border bg-background px-3 text-sm tracking-wide outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
            />
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{t("groupCodeHint")} {mode === "both" && t("groupCodeSkip")}</p>
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          {!required && <Button variant="ghost" onClick={onClose}>{t("cancel2")}</Button>}
          <Button onClick={save} disabled={busy || !canSave}>{t("profileSave")}</Button>
        </div>
      </div>
    </div>
  );
}
