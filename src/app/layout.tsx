import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SimOrg Middleware",
  description: "Access-controlled API gateway for the SimOrg ERP (FR + SA).",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
