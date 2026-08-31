import type { Accent } from "@/lib/domain";

/**
 * Static Tailwind class lookups per certification accent.
 *
 * Tailwind's JIT scanner needs literal class names in the source — it cannot
 * see through `` `bg-certAccent-${accent}-solid` `` template interpolation. This
 * table is what makes that string interpolation safe: every class it could
 * ever produce is already written out here for the scanner to find.
 */
export const ACCENT_SOLID_BG: Record<Accent, string> = {
  indigo: "bg-certAccent-indigo-solid",
  teal: "bg-certAccent-teal-solid",
  amber: "bg-certAccent-amber-solid",
  plum: "bg-certAccent-plum-solid",
  slate: "bg-certAccent-slate-solid",
};

export const ACCENT_SOFT_BG: Record<Accent, string> = {
  indigo: "bg-certAccent-indigo-soft",
  teal: "bg-certAccent-teal-soft",
  amber: "bg-certAccent-amber-soft",
  plum: "bg-certAccent-plum-soft",
  slate: "bg-certAccent-slate-soft",
};

export const ACCENT_TEXT: Record<Accent, string> = {
  indigo: "text-certAccent-indigo-text",
  teal: "text-certAccent-teal-text",
  amber: "text-certAccent-amber-text",
  plum: "text-certAccent-plum-text",
  slate: "text-certAccent-slate-text",
};

export const ACCENT_SOLID_TEXT: Record<Accent, string> = {
  indigo: "text-certAccent-indigo-solid",
  teal: "text-certAccent-teal-solid",
  amber: "text-certAccent-amber-solid",
  plum: "text-certAccent-plum-solid",
  slate: "text-certAccent-slate-solid",
};

export const ACCENT_BORDER: Record<Accent, string> = {
  indigo: "border-certAccent-indigo-solid",
  teal: "border-certAccent-teal-solid",
  amber: "border-certAccent-amber-solid",
  plum: "border-certAccent-plum-solid",
  slate: "border-certAccent-slate-solid",
};
