import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Chat2Skills",
  description:
    "Upload Markdown questions, chat through answers, clean responses, and export a Claude-ready skills pack.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
