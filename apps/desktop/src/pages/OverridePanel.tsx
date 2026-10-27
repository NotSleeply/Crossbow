import FitItems from "../components/FitItems";
import { notify } from "../notifications/service";
import { useCallback, useEffect, useState } from "react";
import { ipc, type OverrideDef, type OverrideKind, type Profile } from "../ipc";
import { useT } from "../i18n";

/** 覆写面板：列表 + 新建 + 编辑器 + 绑定当前订阅。 */
export default function OverridePanel({
  profiles,
  activeId,
  onChanged,
}: {
  profiles: Profile[];
  activeId: string | null;
  onChanged: () => void;
}) {
  const t = useT();
  const [overrides, setOverrides] = useState<OverrideDef[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState("");
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const active = profiles.find((p) => p.id === activeId);

  const refresh = useCallback(async () => {
    setOverrides(await ipc.listOverrides().catch(() => []));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const create = async (kind: OverrideKind) => {
    if (!newName.trim()) return;
    setCreating(true);
    notify.start("override-create", t("ov.title"));
    try {
      const def = await ipc.createOverride(newName.trim(), kind);
      setNewName("");
      await refresh();
      setEditingId(def.id);
      setDraft(def.content);
      onChanged();
      notify.success(t("ov.title"), "override-create");
    } catch (e) {
      notify.error(e, "override-create");
    } finally {
      setCreating(false);
    }
  };

  /**
   * 保存流程（校验先行）：
   * 1. 落库内容 → 2. 校验渲染 → 失败：⚠ 标注错误、内核不动
   *                     → 成功：清除错误并热重启应用
   */
  const save = async (id: string, content: string) => {
    notify.start("override-save", t("ov.title"));
    try {
      await ipc.updateOverride(id, content);
      await ipc.validateOverrides();
      await ipc.applyOverrides();
      setEditingId(null);
      notify.success(t("ov.title"), "override-save");
      await refresh();
      onChanged();
    } catch (e) {
      notify.error(e, "override-save");
      await refresh(); // 拉取 last_error 展示 ⚠
      onChanged();
    }
  };

  const commitRename = async (id: string, name: string) => {
    setRenamingId(null);
    if (!name.trim()) return;
    try {
      await ipc.updateOverride(id, undefined, name.trim());
      await refresh();
      notify.success(t("profiles.rename"), "override-rename");
    } catch (e) {
      notify.error(e, "override-rename");
    }
  };

  const remove = async (id: string) => {
    try {
      await ipc.removeOverride(id);
      setEditingId(null);
      notify.success(t("ov.title"), "override-remove");
      await refresh();
      onChanged();
    } catch (e) {
      notify.error(e, "override-remove");
    }
  };

  const toggleBind = async (oid: string, bound: boolean) => {
    if (!activeId) return;
    try {
      await ipc.toggleOverrideBinding(activeId, oid, bound);
      onChanged();
      notify.success(t("ov.title"), "override-bind");
    } catch (e) {
      notify.error(e, "override-bind");
    }
  };

  const bound = (oid: string) => active?.override_ids.includes(oid) ?? false;

  const selected =
    overrides.find((override) => override.id === editingId) ?? overrides[0];
  return (
    <section className="cb-overrides-workspace">
      <div className="cb-override-create">
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && newName.trim() && !creating)
              void create("script");
          }}
          placeholder={t("ov.namePlaceholder")}
          className="cb-input cb-selectable"
        />
        <button
          className="cb-btn"
          disabled={creating || !newName.trim()}
          onClick={() => create("script")}
        >
          {creating ? "…" : t("ov.newScript")}
        </button>
        <button
          className="cb-btn"
          disabled={creating || !newName.trim()}
          onClick={() => create("merge")}
        >
          {t("ov.newMerge")}
        </button>
      </div>
      {overrides.length === 0 ? (
        <div className="cb-empty">
          <p>{t("ov.empty")}</p>
        </div>
      ) : (
        <div className="cb-context-layout">
          <nav className="cb-context-nav" aria-label={t("ov.title")}>
            <h2>{t("ov.title")}</h2>
            <FitItems
              items={overrides}
              rowHeight={58}
              label={t("ov.title")}
              render={(override) => (
                <button
                  key={override.id}
                  className={selected?.id === override.id ? "active" : ""}
                  aria-current={
                    selected?.id === override.id ? "page" : undefined
                  }
                  onClick={() => {
                    setEditingId(override.id);
                    setDraft(override.content);
                  }}
                >
                  <span>{override.name}</span>
                  <small>
                    {override.kind === "script"
                      ? t("ov.kindScript")
                      : t("ov.kindMerge")}
                  </small>
                </button>
              )}
            />
          </nav>
          {selected && (
            <div className="cb-override-detail">
              <div className="cb-editor-tools">
                <div className="flex flex-wrap items-center gap-3">
                  {renamingId === selected.id ? (
                    <input
                      autoFocus
                      value={nameDraft}
                      onChange={(e) => setNameDraft(e.target.value)}
                      onBlur={() => commitRename(selected.id, nameDraft)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") e.currentTarget.blur();
                        if (e.key === "Escape") setRenamingId(null);
                      }}
                      className="cb-input"
                    />
                  ) : (
                    <h2 className="text-lg font-medium">{selected.name}</h2>
                  )}
                  <button
                    className="cb-btn"
                    onClick={() => {
                      setNameDraft(selected.name);
                      setRenamingId(selected.id);
                    }}
                  >
                    {t("profiles.rename")}
                  </button>
                </div>
                <label className="flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={selected.enabled}
                    onChange={(e) =>
                      ipc
                        .setOverrideEnabled(selected.id, e.target.checked)
                        .then(async () => {
                          await refresh();
                          onChanged();
                          notify.success(t("ov.enabled"), "override-enabled");
                        })
                        .catch((error) =>
                          notify.error(error, "override-enabled"),
                        )
                    }
                  />
                  {t("ov.enabled")}
                </label>
              </div>
              <div className="cb-editor">
                <div className="cb-editor-head">
                  <span>
                    {selected.kind === "script" ? "JavaScript" : "YAML"}
                  </span>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={activeId ? bound(selected.id) : false}
                      disabled={!activeId}
                      onChange={(e) =>
                        toggleBind(selected.id, e.target.checked)
                      }
                    />
                    {t("ov.bind")}
                  </label>
                </div>
                <textarea
                  aria-label={t("ov.edit")}
                  spellCheck={false}
                  value={editingId === selected.id ? draft : selected.content}
                  onChange={(e) => {
                    setEditingId(selected.id);
                    setDraft(e.target.value);
                  }}
                  className="cb-selectable"
                />
              </div>
              {selected.last_error && (
                <p
                  className="cb-control-note"
                  style={{ color: "var(--cb-warn)" }}
                >
                  {selected.last_error}
                </p>
              )}
              <div className="cb-profile-actions">
                <button
                  className="cb-btn"
                  style={{ color: "var(--cb-bad)" }}
                  onClick={() => remove(selected.id)}
                >
                  {t("profiles.remove")}
                </button>
                <button
                  className="cb-btn primary"
                  onClick={() =>
                    save(
                      selected.id,
                      editingId === selected.id ? draft : selected.content,
                    )
                  }
                >
                  {t("ov.save")}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
