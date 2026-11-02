import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { english, type Message } from "./messages";

export type Theme = "light" | "dark" | "system";
export type Language = "zh-CN" | "en";
const THEME_KEY = "crossbow.site.theme";
const LANGUAGE_KEY = "crossbow.site.language";

function read(key: string) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function save(key: string, value: string) {
  // Private browsing and blocked storage still allow changes for this visit.
  try { localStorage.setItem(key, value); } catch { /* The current preference remains in React state. */ }
}
export function initialTheme(): Theme {
  const value = read(THEME_KEY);
  return value === "light" || value === "dark" ? value : "system";
}
export function initialLanguage(): Language {
  const value = read(LANGUAGE_KEY);
  if (value === "zh-CN" || value === "en") return value;
  return navigator.language.toLowerCase().startsWith("zh") ? "zh-CN" : "en";
}

type Preferences = {
  theme: Theme;
  resolvedTheme: "light" | "dark";
  language: Language;
  setTheme: (theme: Theme) => void;
  setLanguage: (language: Language) => void;
  t: (message: Message) => string;
};
const Context = createContext<Preferences | null>(null);

export function PreferencesProvider({ children }: { children: React.ReactNode }) {
  const [theme, updateTheme] = useState<Theme>(initialTheme);
  const [language, updateLanguage] = useState<Language>(initialLanguage);
  const [systemDark, setSystemDark] = useState(() => matchMedia("(prefers-color-scheme: dark)").matches);
  const resolvedTheme = theme === "system" ? (systemDark ? "dark" : "light") : theme;
  const setTheme = useCallback((next: Theme) => { save(THEME_KEY, next); updateTheme(next); }, []);
  const setLanguage = useCallback((next: Language) => { save(LANGUAGE_KEY, next); updateLanguage(next); }, []);
  const t = useCallback((message: Message): string => language === "en" ? english[message] : message, [language]);

  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const change = () => setSystemDark(media.matches);
    media.addEventListener("change", change);
    const storage = (e: StorageEvent) => {
      if (e.key === THEME_KEY || e.key === null) updateTheme(initialTheme());
      if (e.key === LANGUAGE_KEY || e.key === null) updateLanguage(initialLanguage());
    };
    window.addEventListener("storage", storage);
    return () => { media.removeEventListener("change", change); window.removeEventListener("storage", storage); };
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", resolvedTheme === "dark" ? "#1a1c21" : "#ffffff");
    document.querySelector('meta[name="color-scheme"]')?.setAttribute("content", resolvedTheme);
  }, [resolvedTheme]);
  useEffect(() => {
    document.documentElement.lang = language;
    document.querySelector('meta[name="description"]')?.setAttribute("content", language === "en" ? english["官网介绍"] : "Crossbow 是 macOS / Windows 开源代理客户端，提供社区共建的 Linux 实验版。管理订阅、节点与连接，支持 mihomo / sing-box 双内核。");
  }, [language]);
  const value = useMemo(() => ({ theme, resolvedTheme, language, setTheme, setLanguage, t }), [theme, resolvedTheme, language, setTheme, setLanguage, t]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function usePreferences() {
  const value = useContext(Context);
  if (!value) throw new Error("PreferencesProvider is required");
  return value;
}
