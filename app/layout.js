import "./globals.css";

export const metadata = {
  title: "Lead Scraper",
  description: "Multi-country buyers agent lead scraper",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}