import type { Metadata } from "next";
import { Fraunces, Inter, JetBrains_Mono, Vazirmatn } from "next/font/google";
import { cookies } from "next/headers";
import "./globals.css";
import { I18nProvider } from "@/components/app/i18n";
import { SessionProvider } from "@/components/app/session";
import { OfflineSupport } from "@/components/app/offline-support";
import { LANG_COOKIE, dirOf, isLang } from "@/lib/i18n";

const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  axes: ["opsz", "SOFT"],
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const jetbrains = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
});

/** Dari and Pashto: Inter and Fraunces have no Arabic-script letters. */
const vazirmatn = Vazirmatn({
  variable: "--font-vazirmatn",
  subsets: ["arabic", "latin"],
});

export const metadata: Metadata = {
  title: "ROP Workflow",
  description:
    "Field activities, procurement, documents and approvals for Roots of Peace projects, in one record.",
  icons: { icon: "/icon.svg", apple: "/apple-touch-icon.png" },
  appleWebApp: { capable: true, title: "ROP Workflow", statusBarStyle: "default" },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const saved = (await cookies()).get(LANG_COOKIE)?.value;
  const lang = isLang(saved) ? saved : "en";
  return (
    <html lang={lang} dir={dirOf(lang)}>
      <body className={`${fraunces.variable} ${inter.variable} ${jetbrains.variable} ${vazirmatn.variable} font-sans antialiased`}>
        <I18nProvider initial={lang}>
          <SessionProvider>
            {children}
            <OfflineSupport />
          </SessionProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
