import { useEffect, useRef, useState } from "react";
import { usePreferences, type Theme } from "./preferences";
import type { Message } from "./messages";

export function ThemeIcon({ theme }: { theme: Theme }) {
  return <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {theme === "light" ? <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" /></> : theme === "dark" ? <path d="M20.8 13A9 9 0 0 1 11 3.2 9 9 0 1 0 20.8 13Z" /> : <><rect x="3" y="4" width="18" height="13" rx="2" /><path d="M12 17v4m-4 0h8" /></>}
  </svg>;
}
function LanguageIcon() {
  return <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 5h12M9 3v2m3 0c-1 5-4 8-8 10m1-7c1 3 4 6 7 7m2 6 4-11 4 11m-6-4h5" /></svg>;
}
const themes: { value: Theme; label: Message }[] = [{ value: "light", label: "浅色" }, { value: "dark", label: "深色" }, { value: "system", label: "跟随系统" }];

export default function PreferenceControls() {
  const { t, theme, language, setTheme, setLanguage } = usePreferences();
  const [open, setOpen] = useState<"theme" | "language" | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const themeButton = useRef<HTMLButtonElement>(null);
  const languageButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    root.current?.querySelector<HTMLInputElement>(`[data-preference="${open}"] input:checked`)?.focus({ preventScroll: true });
    const close = (e: PointerEvent | FocusEvent) => {
      const owner = e.target instanceof Element ? e.target.closest("[data-preference]") : null;
      if (!root.current?.contains(owner) || owner?.getAttribute("data-preference") !== open) setOpen(null);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault(); e.stopPropagation(); setOpen(null);
      (open === "theme" ? themeButton : languageButton).current?.focus();
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("focusin", close);
    document.addEventListener("keydown", escape, true);
    return () => { document.removeEventListener("focusin", close); document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", escape, true); };
  }, [open]);
  const chooseTheme = (next: Theme) => { setTheme(next); setOpen(null); themeButton.current?.focus(); };
  const chooseLanguage = (next: "zh-CN" | "en") => { setLanguage(next); setOpen(null); languageButton.current?.focus(); };
  return <div className="preference-controls" ref={root}>
    <div className="preference-anchor" data-preference="theme">
      <button ref={themeButton} className="nav-tool" aria-label={`${t("外观")} · ${t(themes.find(v => v.value === theme)!.label)}`} title={t("使用浅色、深色或系统外观")} aria-expanded={open === "theme"} aria-controls="theme-options" onClick={() => setOpen(v => v === "theme" ? null : "theme")}><ThemeIcon theme={theme} /></button>
      {open === "theme" && <fieldset id="theme-options" className="preference-popover"><legend>{t("外观")}</legend>{themes.map(option => <label key={option.value} className="preference-option"><input type="radio" name="site-theme" value={option.value} checked={theme === option.value} onChange={() => setTheme(option.value)} onClick={() => chooseTheme(option.value)} /><ThemeIcon theme={option.value} /><span>{t(option.label)}</span><span className="option-check" aria-hidden="true"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m3 8 3 3 7-7" /></svg></span></label>)}</fieldset>}
    </div>
    <div className="preference-anchor" data-preference="language">
      <button ref={languageButton} className="nav-tool language-tool" aria-label={`${t("语言")} · ${language === "zh-CN" ? "简体中文" : "English"}`} title={t("切换语言")} aria-expanded={open === "language"} aria-controls="language-options" onClick={() => setOpen(v => v === "language" ? null : "language")}><LanguageIcon /><span>{language === "zh-CN" ? "中" : "EN"}</span></button>
      {open === "language" && <fieldset id="language-options" className="preference-popover"><legend>{t("语言")}</legend>{([{ value: "zh-CN", label: "简体中文" }, { value: "en", label: "English" }] as const).map(option => <label key={option.value} className="preference-option"><input type="radio" name="site-language" value={option.value} checked={language === option.value} onChange={() => setLanguage(option.value)} onClick={() => chooseLanguage(option.value)} /><span lang={option.value}>{option.label}</span><span className="option-check" aria-hidden="true"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m3 8 3 3 7-7" /></svg></span></label>)}</fieldset>}
    </div>
  </div>;
}
