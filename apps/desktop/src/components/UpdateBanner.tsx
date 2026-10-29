import { ProgressRing } from "./ProgressRing";
import { Icon } from "./Icon";
import { useT } from "../i18n";
import type { UpdateState } from "../ipc";

/** Persistent update entry; installation remains an explicit action in Settings. */
export function UpdateBanner({
  update,
  onOpen,
}: {
  update: UpdateState;
  onOpen: () => void;
}) {
  const t = useT();
  const downloading = !update.downloaded && update.progress !== null;
  const percent =
    downloading && update.progress![1] > 0
      ? Math.min(
          100,
          Math.max(
            0,
            Math.floor((update.progress![0] / update.progress![1]) * 100),
          ),
        )
      : null;
  const title = update.downloaded
    ? t("home.updateReady")
    : downloading
      ? t("home.updateDownloading")
      : t("home.updateAvailable");
  const action = update.downloaded
    ? t("home.updateInstall")
    : downloading
      ? t("home.updateViewProgress")
      : t("home.updateGoBtn");

  return (
    <button className="cb-update-banner" type="button" onClick={onOpen}>
      <span className="cb-update-icon" aria-hidden="true">
        {downloading ? (
          <ProgressRing value={percent} label={title} size={16} />
        ) : (
          <Icon name={update.downloaded ? "check" : "download"} size={16} />
        )}
      </span>
      <span className="cb-update-content">
        <span className="cb-update-title">{title}</span>
        <span className="cb-update-version" title={`v${update.version}`}>
          v{update.version}
        </span>
        {percent !== null && (
          <span className="cb-update-percent">{percent}%</span>
        )}
      </span>
      <span className="cb-update-action">
        {action}
        <span aria-hidden="true">
          <Icon name="arrow-right" size={14} />
        </span>
      </span>
    </button>
  );
}
