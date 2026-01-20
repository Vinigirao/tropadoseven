import "./globals.css";

/**
 * The root layout wraps all pages and provides the HTML structure.
 */
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}