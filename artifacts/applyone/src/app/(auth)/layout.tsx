import type { ReactNode } from "react";
import Link from "next/link";

import { Wordmark } from "@/components/brand/wordmark";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-canvas">
      <header className="mx-auto flex h-16 max-w-6xl items-center px-5 sm:px-8">
        <Link href="/">
          <Wordmark />
        </Link>
      </header>
      <main className="mx-auto flex w-full max-w-md flex-col px-5 pb-16 pt-10 sm:px-8">{children}</main>
    </div>
  );
}
