import { Button, ButtonBase } from "../components/Button";
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
  const [savingId, setSavingId] = useState<string | null>(null);
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
    try {
      const def = await ipc.createOverride(newName.trim(), kind);
      setNewName("");
      await refresh();
      setEditingId(def.id);
      setDraft(def.content);
      onChanged();
      void notify.resolve("override-create");
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
    if (savingId) return;
    setSavingId(id);
    try {
      await ipc.updateOverride(id, content);
      await ipc.validateOverrides();
      await ipc.applyOverrides();
      setEditingId(null);
      void notify.resolve(`override-save-${id}`);
      await refresh();
      onChanged();
    } catch (e) {
      notify.error(e, `override-save-${id}`);
      await refresh(); // 拉取 last_error 展示 ⚠
      onChanged();
    } finally {
      setSavingId(null);
    }
  };

  const commitRename = async (id: string, name: string) => {
    setRenamingId(null);
    if (!name.trim()) return;
    try {
      await ipc.updateOverride(id, undefined, name.trim());
      await refresh();
      void notify.resolve(`override-rename-${id}`);
    } catch (e) {
      notify.error(e, `override-rename-${id}`);
    }
  };

  const remove = async (id: string) => {
    try {
      await ipc.removeOverride(id);
      setEditingId(null);
      void notify.resolve(`override-remove-${id}`);
      await refresh();
      onChanged();
    } catch (e) {
      notify.error(e, `override-remove-${id}`);
    }
  };

  const toggleBind = async (oid: string, bound: boolean) => {
    if (!activeId) return;
    try {
      await ipc.toggleOverrideBinding(activeId, oid, bound);
      onChanged();
      void notify.resolve(`override-bind-${activeId}-${oid}`);
    } catch (e) {
      notify.error(e, `override-bind-${activeId}-${oid}`);
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
        <Button
          disabled={creating || !newName.trim()}
          onClick={() => create("script")}
        >
          {creating ? "…" : t("ov.newScript")}
        </Button>
        <Button
          disabled={creating || !newName.trim()}
          onClick={() => create("merge")}
        >
          {t("ov.newMerge")}
        </Button>
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
                <ButtonBase
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
                </ButtonBase>
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
                  <Button
                    onClick={() => {
                      setNameDraft(selected.name);
                      setRenamingId(selected.id);
                    }}
                  >
                    {t("profiles.rename")}
                  </Button>
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
                          void notify.resolve(
                            `override-enabled-${selected.id}`,
                          );
                        })
                        .catch((error) =>
                          notify.error(
                            error,
                            `override-enabled-${selected.id}`,
                          ),
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
                <Button
                  tone="danger"
                  onClick={() => remove(selected.id)}
                >
                  {t("profiles.remove")}
                </Button>
                <Button variant="primary"
                  disabled={savingId !== null}
                  loading={savingId === selected.id}
                  onClick={() =>
                    save(
                      selected.id,
                      editingId === selected.id ? draft : selected.content,
                    )
                  }
                >
                  {savingId === selected.id ? "…" : t("ov.save")}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
