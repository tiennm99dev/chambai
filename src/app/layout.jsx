import { Geist, Geist_Mono } from "next/font/google";
import OpenCvLoader from "@/components/opencv-loader";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata = {
  title: "Test Scoring App - Vietnamese Multiple Choice",
  description: "Automated scoring system for Vietnamese multiple choice tests",
};

export default function RootLayout({ children }) {
  return (
    <html lang="vi">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <OpenCvLoader />
        {children}
      </body>
    </html>
  );
}
