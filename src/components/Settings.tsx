import { useState, useEffect } from "react";
import { X, Monitor, Sun, Moon, Keyboard, SlidersHorizontal, Save, RotateCcw, Globe } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAppStore, type Theme } from "@/store/appStore";
import { useSettingsStore } from "@/store/settingsStore";
import { SHORTCUT_DEFS, comboToDisplay, eventToCombo } from "@/lib/shortcuts";
import { cn } from "@/lib/utils";
import { setLanguage, SUPPORTED_LANGS } from "@/i18n";

type Section = "editor" | "shortcuts" | "language";

export function Settings() {
  const { t, i18n } = useTranslation();
  const { setSettingsVisible } = useAppStore();
  const {
    fontSize, setFontSize,
    autoSave, setAutoSave,
    theme, setTheme,
    customShortcuts, setCustomShortcut, resetCustomShortcut,
  } = useSettingsStore();

  const [section, setSection] = useState<Section>("editor");

  function close() { setSettingsVisible(false); }

  // Close on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.45)" }}
      onClick={close}
    >
      <div
        className="flex h-[540px] w-[700px] overflow-hidden rounded-xl border border-border bg-background shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Left nav */}
        <div className="flex w-44 shrink-0 flex-col border-r border-border bg-muted/40 pt-4">
          <div className="px-4 pb-3">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">
              {t("settings.title")}
            </p>
          </div>
          {(
            [
              { id: "editor",    label: t("settings.sections.editor"),    icon: <SlidersHorizontal className="h-3.5 w-3.5" /> },
              { id: "shortcuts", label: t("settings.sections.shortcuts"), icon: <Keyboard className="h-3.5 w-3.5" /> },
              { id: "language",  label: t("settings.sections.language"),  icon: <Globe className="h-3.5 w-3.5" /> },
            ] as { id: Section; label: string; icon: React.ReactNode }[]
          ).map((s) => (
            <button
              key={s.id}
              onClick={() => setSection(s.id)}
              className={cn(
                "flex items-center gap-2.5 px-4 py-2 text-left text-sm transition-colors",
                section === s.id
                  ? "bg-background text-foreground"
                  : "text-muted-foreground hover:bg-background/60 hover:text-foreground"
              )}
            >
              {s.icon}
              {s.label}
            </button>
          ))}
        </div>

        {/* Right content */}
        <div className="flex flex-1 flex-col overflow-hidden">
          <div className="flex items-center justify-between border-b border-border px-5 py-3">
            <h2 className="text-sm font-semibold">
              {section === "editor" ? t("settings.editor.title") : section === "shortcuts" ? t("settings.shortcuts.title") : t("settings.language.label")}
            </h2>
            <button onClick={close} className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground">
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-5">
            {section === "editor" && (
              <EditorSettings
                fontSize={fontSize} setFontSize={setFontSize}
                autoSave={autoSave} setAutoSave={setAutoSave}
                theme={theme} setTheme={setTheme}
              />
            )}
            {section === "shortcuts" && (
              <ShortcutsSettings
                customShortcuts={customShortcuts}
                setCustomShortcut={setCustomShortcut}
                resetCustomShortcut={resetCustomShortcut}
              />
            )}
            {section === "language" && (
              <LanguageSettings currentLang={i18n.language} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Editor settings ───────────────────────────────────────────────────────────
function EditorSettings({ fontSize, setFontSize, autoSave, setAutoSave, theme, setTheme }: {
  fontSize: number; setFontSize: (n: number) => void;
  autoSave: boolean; setAutoSave: (v: boolean) => void;
  theme: Theme; setTheme: (t: Theme) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-6">
      <SettingRow label={t("settings.editor.theme.label")} desc={t("settings.editor.theme.desc")}>
        <div className="flex gap-2">
          {([
            { value: "system", label: t("settings.editor.theme.system"), icon: <Monitor className="h-3.5 w-3.5" /> },
            { value: "paper",  label: t("settings.editor.theme.paper"),  icon: <Sun    className="h-3.5 w-3.5" /> },
            { value: "ink",    label: t("settings.editor.theme.ink"),    icon: <Moon   className="h-3.5 w-3.5" /> },
          ] as { value: Theme; label: string; icon: React.ReactNode }[]).map((opt) => (
            <button key={opt.value} onClick={() => setTheme(opt.value)}
              className={cn(
                "flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm transition-colors",
                theme === opt.value
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:border-muted-foreground hover:text-foreground"
              )}>
              {opt.icon}{opt.label}
            </button>
          ))}
        </div>
      </SettingRow>

      <SettingRow label={t("settings.editor.fontSize.label")} desc={t("settings.editor.fontSize.desc", { size: fontSize })}>
        <div className="flex items-center gap-3">
          <input type="range" min={14} max={20} step={1} value={fontSize}
            onChange={(e) => setFontSize(Number(e.target.value))}
            className="h-1.5 w-32 cursor-pointer accent-primary" />
          <div className="flex gap-1">
            {[14, 15, 16, 17, 18, 20].map((s) => (
              <button key={s} onClick={() => setFontSize(s)}
                className={cn(
                  "rounded px-2 py-0.5 text-xs transition-colors",
                  fontSize === s ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
                )}>
                {s}
              </button>
            ))}
          </div>
        </div>
      </SettingRow>

      <SettingRow label={t("settings.editor.autoSave.label")} desc={t("settings.editor.autoSave.desc")}>
        <Toggle checked={autoSave} onChange={setAutoSave} />
      </SettingRow>

      {!autoSave && (
        <div className="flex items-center gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
          <Save className="h-3.5 w-3.5 shrink-0" />
          {t("settings.editor.autoSave.offWarning")}
        </div>
      )}
    </div>
  );
}

// ── Language settings ─────────────────────────────────────────────────────────
function LanguageSettings({ currentLang }: { currentLang: string }) {
  const { t } = useTranslation();
  const langNames = t("language.languages", { returnObjects: true }) as Record<string, string>;

  return (
    <div className="space-y-4">
      <SettingRow label={t("settings.language.label")} desc={t("settings.language.desc")}>
        <div className="flex flex-col gap-2">
          {SUPPORTED_LANGS.map((lang) => (
            <button
              key={lang}
              onClick={() => setLanguage(lang)}
              className={cn(
                "rounded-md border px-4 py-2 text-sm text-left transition-colors",
                currentLang === lang
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:border-muted-foreground hover:text-foreground"
              )}
            >
              {langNames[lang] ?? lang}
            </button>
          ))}
        </div>
      </SettingRow>
    </div>
  );
}

// ── Shortcuts settings ────────────────────────────────────────────────────────
function ShortcutsSettings({ customShortcuts, setCustomShortcut, resetCustomShortcut }: {
  customShortcuts: Record<string, string>;
  setCustomShortcut: (id: string, combo: string) => void;
  resetCustomShortcut: (id: string) => void;
}) {
  const { t } = useTranslation();
  const [recording, setRecording] = useState<string | null>(null); // shortcut id being recorded

  const groups = SHORTCUT_DEFS.reduce<Record<string, typeof SHORTCUT_DEFS>>((acc, s) => {
    (acc[s.group] = acc[s.group] ?? []).push(s);
    return acc;
  }, {});

  function startRecord(id: string) { setRecording(id); }
  function cancelRecord() { setRecording(null); }

  useEffect(() => {
    if (!recording) return;

    function onKey(e: KeyboardEvent) {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.key === "Escape") { cancelRecord(); return; }
      const combo = eventToCombo(e);
      if (!combo) return;
      setCustomShortcut(recording!, combo);
      setRecording(null);
    }

    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [recording]);

  return (
    <div className="space-y-5">
      <p className="text-xs text-muted-foreground">
        {t("settings.shortcuts.hint")} <kbd className="rounded bg-muted px-1">Esc</kbd>
      </p>

      {Object.entries(groups).map(([group, shortcuts]) => (
        <div key={group}>
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
            {t(group)}
          </p>
          <div className="overflow-hidden rounded-md border border-border">
            {shortcuts.map((s, i) => {
              const isRecording = recording === s.id;
              const customCombo = customShortcuts[s.id];
              const effectiveCombo = customCombo ?? s.defaultKey;
              const isCustom = !!customCombo && customCombo !== s.defaultKey;

              return (
                <div key={s.id}
                  className={cn(
                    "flex items-center justify-between px-3 py-2",
                    i < shortcuts.length - 1 && "border-b border-border"
                  )}>
                  <span className="text-sm text-foreground">{t(s.label)}</span>

                  <div className="flex items-center gap-2">
                    {/* Reset button — shown when customized */}
                    {isCustom && (
                      <button
                        onClick={() => resetCustomShortcut(s.id)}
                        title={t("settings.shortcuts.resetTitle")}
                        className="rounded p-0.5 text-muted-foreground/50 hover:text-muted-foreground"
                      >
                        <RotateCcw className="h-3 w-3" />
                      </button>
                    )}

                    {/* Key badge — click to record */}
                    <button
                      onClick={() => isRecording ? cancelRecord() : startRecord(s.id)}
                      className={cn(
                        "min-w-[60px] rounded border px-2 py-1 font-mono text-[11px] transition-colors text-center",
                        isRecording
                          ? "animate-pulse border-primary bg-primary/10 text-primary"
                          : isCustom
                            ? "border-primary/40 bg-primary/5 text-primary hover:border-primary"
                            : "border-border bg-muted text-foreground hover:border-muted-foreground"
                      )}
                    >
                      {isRecording
                        ? t("settings.shortcuts.recording")
                        : comboToDisplay(effectiveCombo)}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Shared helpers ────────────────────────────────────────────────────────────
function SettingRow({ label, desc, children }: { label: string; desc: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-6">
      <div className="shrink-0">
        <p className="text-sm font-medium text-foreground">{label}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{desc}</p>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button role="switch" aria-checked={checked} onClick={() => onChange(!checked)}
      className={cn("relative h-5 w-9 rounded-full transition-colors",
        checked ? "bg-primary" : "bg-muted-foreground/30")}>
      <span className={cn("absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform",
        checked ? "translate-x-4" : "translate-x-0.5")} />
    </button>
  );
}
