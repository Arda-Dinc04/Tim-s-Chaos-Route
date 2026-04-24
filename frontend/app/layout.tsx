import type { Metadata, Viewport } from "next";
import { Luckiest_Guy } from "next/font/google";
import "leaflet/dist/leaflet.css";
import "./globals.css";

const luckiestGuy = Luckiest_Guy({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-luckiest-guy",
});

export const metadata: Metadata = {
  title: "Shortcut Bike Router",
  description: "Experimental OSM-based NYC bike routing demo.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  themeColor: "#f4f1e8",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={luckiestGuy.variable}>{children}</body>
    </html>
  );
}
