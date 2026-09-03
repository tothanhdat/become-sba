"use client";

import { useRouter } from "next/navigation";

/** Returns to the previous page in browser history. */
export function BackButton({ className }: { className?: string }) {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => router.back()}
      className={className ?? "shrink-0 text-body-small text-ink-secondary transition-colors hover:text-ink-primary"}
    >
      ← Trở lại
    </button>
  );
}
