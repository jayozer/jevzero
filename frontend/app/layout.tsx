import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "JevZero — Clear inbox. Clear head.",
  description: "Thoughtful email classification. You’re in control.",
  robots: { index: false, follow: false },
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
