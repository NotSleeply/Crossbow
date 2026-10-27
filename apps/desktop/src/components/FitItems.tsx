import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useT } from "../i18n";

/** Paginate finite option lists instead of adding a second page scrollbar. */
export default function FitItems<T>({
  items,
  render,
  rowHeight = 64,
  minWidth = 0,
  maxColumns = 1,
  label,
}: {
  items: T[];
  render: (item: T) => ReactNode;
  rowHeight?: number;
  minWidth?: number;
  maxColumns?: number;
  label: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [page, setPage] = useState(0);
  const t = useT();
  useLayoutEffect(() => {
    const update = () => {
      const e = ref.current;
      if (e) setSize({ width: e.clientWidth, height: e.clientHeight });
    };
    const observer = new ResizeObserver(update);
    if (ref.current) observer.observe(ref.current);
    update();
    return () => observer.disconnect();
  }, []);
  const columns = minWidth
    ? Math.max(
        1,
        Math.min(maxColumns, Math.floor((size.width + 10) / (minWidth + 10))),
      )
    : 1;
  const fullRows = Math.max(1, Math.floor((size.height + 8) / (rowHeight + 8)));
  const needsPager = items.length > columns * fullRows;
  const rows = Math.max(
    1,
    Math.floor((size.height - (needsPager ? 32 : 0) + 8) / (rowHeight + 8)),
  );
  const count = rows * columns;
  const pages = Math.max(1, Math.ceil(items.length / count));
  const active = Math.min(page, pages - 1);
  return (
    <div ref={ref} className="cb-fit-items" aria-label={label}>
      <div
        className="cb-fit-cells"
        style={{
          gridTemplateColumns: `repeat(${columns},minmax(0,1fr))`,
          gridAutoRows: rowHeight,
        }}
      >
        {items.slice(active * count, (active + 1) * count).map(render)}
      </div>
      {pages > 1 && (
        <nav className="cb-fit-pager" aria-label={label}>
          <button
            disabled={active === 0}
            onClick={() => setPage(active - 1)}
            aria-label={t("studio.previous")}
          >
            ‹
          </button>
          <span>
            {active + 1} / {pages}
          </span>
          <button
            disabled={active + 1 >= pages}
            onClick={() => setPage(active + 1)}
            aria-label={t("studio.next")}
          >
            ›
          </button>
        </nav>
      )}
    </div>
  );
}
