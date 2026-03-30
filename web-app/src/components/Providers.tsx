'use client';

import { SessionProvider } from "next-auth/react";
import { BackgroundSessionPostProcessor } from "./BackgroundSessionPostProcessor";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <BackgroundSessionPostProcessor />
      {children}
    </SessionProvider>
  );
}
