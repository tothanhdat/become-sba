"use client";

import { signOut } from "next-auth/react";

export function SignOutButton() {
  return (
    <button
      type="button"
      onClick={() => void signOut({ callbackUrl: "/dashboard" })}
      className="text-body-small text-ink-secondary hover:text-ink-primary"
    >
      Đăng xuất
    </button>
  );
}
