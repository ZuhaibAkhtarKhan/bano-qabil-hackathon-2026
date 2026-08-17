import type { ReactNode } from "react";
import type { Metadata } from "next";
import { Geist, Geist_Mono, Instrument_Serif } from "next/font/google";

import "./globals.css";

const geist = Geist({
  subsets: ["latin"],
  variable: "--font-geist",
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
});

const instrument = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-instrument",
});

export const metadata: Metadata = {
  title: {
    default: "1-Apply — Create once. Apply everywhere.",
    template: "%s · 1-Apply",
  },
  description:
    "An AI-powered personal application agent that remembers your experience, prepares grounded applications, and tracks everything you submit.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className={`${geist.variable} ${geistMono.variable} ${instrument.variable} font-sans antialiased`}>
        {children}
      </body>
    </html>
  );
}
