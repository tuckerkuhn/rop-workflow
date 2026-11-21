import { DialogHost } from "@/components/app/dialogs";
import { SavingSign } from "@/components/app/saving-sign";
import type { Metadata } from "next";
import { Archivo_Narrow, Fraunces, Inter, JetBrains_Mono, Plus_Jakarta_Sans, Vazirmatn } from "next/font/google";
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

/** Home's two views (components/home/home-views): heavy numerals for the bands, a narrow face for the ledger. */
const jakarta = Plus_Jakarta_Sans({ variable: "--font-jakarta", subsets: ["latin"], weight: ["500", "700", "800"] });
const archivo = Archivo_Narrow({ variable: "--font-archivo", subsets: ["latin"], weight: ["400", "600", "700"] });

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
      <body className={`${fraunces.variable} ${inter.variable} ${jetbrains.variable} ${vazirmatn.variable} ${jakarta.variable} ${archivo.variable} font-sans antialiased`}>
        <I18nProvider initial={lang}>
          <SessionProvider>
            {children}
            <OfflineSupport />
            <DialogHost />
            <SavingSign />
          </SessionProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
