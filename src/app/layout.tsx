import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'INNOSOM Social OS',
  description: 'Internal Agency Social Media Operations Platform',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="bg-neutral-900 text-neutral-100 antialiased min-h-screen">
        {children}
      </body>
    </html>
  );
}
