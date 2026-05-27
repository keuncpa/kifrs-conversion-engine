import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'K-IFRS 컨버전 시스템',
  description: 'K-GAAP 감사보고서를 K-IFRS 기준으로 자동 전환',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
