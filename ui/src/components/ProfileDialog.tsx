import { useEffect, useRef, useState } from "react";
import { UserRound } from "lucide-react";
import type { Profile } from "@/api";
import type { Key } from "@/i18n";
import { Button } from "@/components/ui/button";

type T = (k: Key) => string;

interface Props {
  t: T;
  profile: Profile;
  /** first run: there is no name yet, so the dialog cannot be dismissed */
  required: boolean;
  onSave: (name: string) => Promise<void>;
  onClose: () => void;
}

export function ProfileDialog({ t, profile, required, onSave, onClose }: Props) {
  const [name, setName] = useState(profile.name || profile.suggested || "");
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => { input.current?.focus(); input.current?.select(); }, []);
  useEffect(() => {
    if (required) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [required, onClose]);

  const save = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try { await onSave(name.trim()); } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4" role="dialog" aria-modal="true" aria-labelledby="profile-title">
      <div className="enter w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-2xl">
        <div className="mb-4 flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-xl bg-primary/15 text-primary"><UserRound className="size-5" /></div>
          <h2 id="profile-title" className="text-base font-semibold">{t("profileTitle")}</h2>
        </div>
        <p className="mb-4 text-xs leading-relaxed text-muted-foreground">{t("profileHint")}</p>
        <label className="mb-1.5 block text-xs font-medium text-muted-foreground" htmlFor="profile-name">{t("profileName")}</label>
        <input
          id="profile-name"
          ref={input}
          value={name}
          maxLength={24}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") void save(); }}
          className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
        />
        <div className="mt-5 flex justify-end gap-2">
          {!required && <Button variant="ghost" onClick={onClose}>{t("cancel2")}</Button>}
          <Button onClick={save} disabled={busy || !name.trim()}>{t("profileSave")}</Button>
        </div>
      </div>
    </div>
  );
}
