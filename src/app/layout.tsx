import { DialogHost } from "@/components/app/dialogs";
import { SavingSign } from "@/components/app/saving-sign";
import type { Metadata } from "next";
import localFont from "next/font/local";
import { cookies } from "next/headers";
import "./globals.css";
import { I18nProvider } from "@/components/app/i18n";
import { SessionProvider } from "@/components/app/session";
import { OfflineSupport } from "@/components/app/offline-support";
import { LANG_COOKIE, dirOf, isLang } from "@/lib/i18n";

/**
 * The fonts ship with the app (the @fontsource-variable packages), so a build never waits on
 * Google Fonts: a fetch that failed once stopped a deploy.
 */
/** Headings: Fraunces with its optical size and softness axes. */
const fraunces = localFont({ variable: "--font-fraunces", src: "../../node_modules/@fontsource-variable/fraunces/files/fraunces-latin-full-normal.woff2", weight: "100 900", display: "swap" });
const inter = localFont({ variable: "--font-inter", src: "../../node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2", weight: "100 900", display: "swap" });
const jetbrains = localFont({ variable: "--font-jetbrains", src: "../../node_modules/@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2", weight: "100 800", display: "swap" });

/** Home's two views (components/home/home-views): heavy numerals for the bands, a narrow face for the ledger. */
const jakarta = localFont({ variable: "--font-jakarta", src: "../../node_modules/@fontsource-variable/plus-jakarta-sans/files/plus-jakarta-sans-latin-wght-normal.woff2", weight: "200 800", display: "swap" });
const archivo = localFont({ variable: "--font-archivo", src: "../../node_modules/@fontsource-variable/archivo-narrow/files/archivo-narrow-latin-wght-normal.woff2", weight: "400 700", display: "swap" });

/**
 * Dari and Pashto: Inter and Fraunces have no Arabic-script letters. Only the Arabic-script file,
 * for those letters only; Latin text on those pages falls through to Inter (globals.css).
 */
const vazirmatn = localFont({
  variable: "--font-vazirmatn",
  src: "../../node_modules/@fontsource-variable/vazirmatn/files/vazirmatn-arabic-wght-normal.woff2",
  weight: "100 900",
  display: "swap",
  declarations: [{ prop: "unicode-range", value: "U+0600-06FF, U+0750-077F, U+0870-088E, U+0890-0891, U+0897-08E1, U+08E3-08FF, U+200C-200E, U+2010-2011, U+204F, U+2E41, U+FB50-FDFF, U+FE70-FE74, U+FE76-FEFC" }],
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
