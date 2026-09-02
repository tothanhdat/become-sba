"use client";

import { signIn } from "next-auth/react";

export function SignInButton({ callbackUrl }: { callbackUrl?: string }) {
  return (
    <button
      type="button"
      onClick={() => void signIn("google", { callbackUrl })}
      className="rounded-lg bg-accent-solid px-3.5 py-1.5 text-body-small text-ink-inverse"
    >
      Đăng nhập với Google
    </button>
  );
}
