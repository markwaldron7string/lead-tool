import "./globals.css";

export const metadata = {
  title: "Lead Scraper — Buyers Agent Australia",
  description: "Upload, deduplicate and categorise buyers agent leads from Apify",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}