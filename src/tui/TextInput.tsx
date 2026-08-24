import React from "react";
import { Text, useInput } from "ink";

interface TextInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit?: (value: string) => void;
  active: boolean;
  placeholder?: string;
  mask?: boolean;
}

/**
 * Minimal single-line text input, built directly on Ink's useInput (no
 * extra dependency). Supports printable characters, backspace, and Enter to
 * submit.
 */
export function TextInput({
  value,
  onChange,
  onSubmit,
  active,
  placeholder,
  mask,
}: TextInputProps): React.ReactElement {
  useInput(
    (input, key) => {
      if (!active) return;
      if (key.return) {
        onSubmit?.(value);
        return;
      }
      if (key.backspace || key.delete) {
        onChange(value.slice(0, -1));
        return;
      }
      if (key.ctrl || key.meta) return;
      if (input) {
        onChange(value + input);
      }
    },
    { isActive: active }
  );

  const display = value ? (mask ? "*".repeat(value.length) : value) : placeholder ?? "";
  return <Text color={value ? undefined : "gray"}>{display || " "}</Text>;
}
