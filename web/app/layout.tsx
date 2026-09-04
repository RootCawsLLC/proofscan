import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'proofscan — run it in the browser',
  description:
    'A hosted demo of proofscan: run the real scanner against a sandboxed target or your own source and watch a finding become verified-exploitable only when an executed exploit changes another user’s data.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="wrap">{children}</div>
      </body>
    </html>
  );
}
