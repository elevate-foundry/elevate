import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Exposure Dashboard — elevate-foundry",
  description:
    "AI crawl/training exposure of public GitHub repos: forks, Common Crawl captures, and a SOC 2 audit trail.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
