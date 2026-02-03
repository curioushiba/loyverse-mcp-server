import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Loyverse MCP Server",
  description: "Remote MCP server for Loyverse restaurant accounts",
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
