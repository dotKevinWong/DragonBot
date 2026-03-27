import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "DragonBot Dashboard",
  description: "Manage your DragonBot settings and profile",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-dc-bg-tertiary text-dc-text-primary font-[system-ui,sans-serif] m-0">
        {children}
      </body>
    </html>
  );
}
