import { useState } from "react";
import { Select as SelectPrimitive } from "@base-ui/react/select";
import { Icon } from "./Icon";
import "./Select.css";

export interface SelectOption {
  value: string | number;
  label: string;
  disabled?: boolean;
}

/** Shared desktop select: one visual system, with keyboard/focus/portal behavior from Base UI. */
export default function Select({
  value,
  options,
  onChange,
  label,
  className = "",
  size = "default",
  disabled = false,
}: {
  value: string | number;
  options: SelectOption[];
  onChange: (value: string) => void;
  label: string;
  className?: string;
  size?: "default" | "compact";
  disabled?: boolean;
}) {
  const [keyboard, setKeyboard] = useState(false);
  const items = options.map((option) => ({
    ...option,
    value: String(option.value),
  }));
  const current = items.find((option) => option.value === String(value));
  return (
    <div className={`cb-select ${className}`} data-size={size}>
      <SelectPrimitive.Root
        items={items}
        value={String(value)}
        onValueChange={(next) => {
          if (next !== null) onChange(next);
        }}
        disabled={disabled || items.length === 0}
        modal={false}
      >
        <SelectPrimitive.Trigger
          className="cb-select-trigger"
          aria-label={label}
          title={current?.label}
          onPointerDown={() => setKeyboard(false)}
          onKeyDown={() => setKeyboard(true)}
          data-instant={keyboard || undefined}
        >
          <SelectPrimitive.Value className="cb-select-value" placeholder="—" />
          <SelectPrimitive.Icon className="cb-select-chevron">
            <Icon name="chevron" size={12} />
          </SelectPrimitive.Icon>
        </SelectPrimitive.Trigger>
        <SelectPrimitive.Portal>
          <SelectPrimitive.Positioner
            className="cb-select-positioner"
            side="bottom"
            align="start"
            sideOffset={6}
            collisionPadding={8}
            alignItemWithTrigger={false}
          >
            <SelectPrimitive.Popup
              className="cb-select-popup"
              data-instant={keyboard || undefined}
              onKeyDown={() => setKeyboard(true)}
            >
              <SelectPrimitive.List className="cb-select-list">
                {items.map((option) => (
                  <SelectPrimitive.Item
                    key={option.value}
                    value={option.value}
                    label={option.label}
                    disabled={option.disabled}
                    className="cb-select-option"
                  >
                    <SelectPrimitive.ItemText className="cb-select-option-text">
                      {option.label}
                    </SelectPrimitive.ItemText>
                    <SelectPrimitive.ItemIndicator className="cb-select-check">
                      <Icon name="check" size={14} strokeWidth={2} />
                    </SelectPrimitive.ItemIndicator>
                  </SelectPrimitive.Item>
                ))}
              </SelectPrimitive.List>
            </SelectPrimitive.Popup>
          </SelectPrimitive.Positioner>
        </SelectPrimitive.Portal>
      </SelectPrimitive.Root>
    </div>
  );
}
