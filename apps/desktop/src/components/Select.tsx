import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export interface SelectOption {
  value: string | number;
  label: string;
}

/** Portal keeps the option list visible outside the fixed-height content sheet. */
export default function Select({
  value,
  options,
  onChange,
  className = "",
}: {
  value: string | number;
  options: SelectOption[];
  onChange: (value: string) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({
    left: 0,
    top: 0,
    width: 160,
    height: 240,
  });
  const button = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const id = useId();
  const current = options.find(
    (option) => String(option.value) === String(value),
  );
  useLayoutEffect(() => {
    if (!open || !button.current) return;
    const box = button.current.getBoundingClientRect();
    const width = Math.min(
      300,
      Math.max(box.width, 160),
      window.innerWidth - 24,
    );
    const below = window.innerHeight - box.bottom - 12,
      above = box.top - 12;
    const upwards =
      below < Math.min(240, options.length * 34 + 8) && above > below;
    const height = Math.max(
      34,
      Math.min(240, upwards ? above - 6 : below - 6, options.length * 34 + 8),
    );
    setPosition({
      left: Math.max(12, Math.min(box.left, window.innerWidth - width - 12)),
      top: upwards ? box.top - height - 6 : box.bottom + 6,
      width,
      height,
    });
  }, [open, options.length]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: MouseEvent) => {
      if (
        !button.current?.contains(event.target as Node) &&
        !popup.current?.contains(event.target as Node)
      )
        setOpen(false);
    };
    const resize = () => setOpen(false);
    document.addEventListener("mousedown", outside);
    window.addEventListener("resize", resize);
    const selected =
      popup.current?.querySelector<HTMLButtonElement>(
        '[aria-selected="true"]',
      ) ?? popup.current?.querySelector("button");
    selected?.focus();
    selected?.scrollIntoView({ block: "nearest" });
    return () => {
      document.removeEventListener("mousedown", outside);
      window.removeEventListener("resize", resize);
    };
  }, [open]);
  const close = () => {
    setOpen(false);
    button.current?.focus();
  };
  return (
    <div className={`relative ${className}`}>
      <button
        ref={button}
        type="button"
        role="combobox"
        aria-expanded={open}
        aria-controls={id}
        aria-haspopup="listbox"
        onClick={() => setOpen(!open)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
          }
        }}
        className="cb-input cb-select-trigger"
        title={current?.label}
      >
        <span>{current?.label ?? "—"}</span>
        <svg
          width="10"
          height="10"
          viewBox="0 0 10 10"
          fill="none"
          stroke="currentColor"
          aria-hidden="true"
          style={{ transform: open ? "rotate(180deg)" : undefined }}
        >
          <path d="m2 3.5 3 3 3-3" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      </button>
      {open &&
        createPortal(
          <div
            ref={popup}
            id={id}
            role="listbox"
            className="cb-select-options"
            style={{
              left: position.left,
              top: position.top,
              width: position.width,
              maxHeight: position.height,
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                close();
              }
              if (event.key === "Tab") {
                setOpen(false);
                return;
              }
              const buttons = [
                ...(popup.current?.querySelectorAll<HTMLButtonElement>(
                  "button",
                ) ?? []),
              ];
              const index = buttons.indexOf(
                document.activeElement as HTMLButtonElement,
              );
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                buttons[
                  (index +
                    (event.key === "ArrowDown" ? 1 : buttons.length - 1)) %
                    buttons.length
                ]?.focus();
              }
              if (event.key === "Home" || event.key === "End") {
                event.preventDefault();
                buttons[event.key === "Home" ? 0 : buttons.length - 1]?.focus();
              }
            }}
          >
            {options.map((option) => (
              <button
                key={option.value}
                role="option"
                aria-selected={String(option.value) === String(value)}
                onClick={() => {
                  onChange(String(option.value));
                  close();
                }}
              >
                {option.label}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}
