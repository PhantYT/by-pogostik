import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://by-pogostik.aqua-book-5726.chatgpt.site"),
  title: "by pogostik — учебный хаб",
  description: "Личное учебное пространство студента Высшей IT-школы КГУ: расписание, домашние задания, мероприятия и музыка для фокуса.",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
  openGraph: {
    title: "by pogostik — учёба без хаоса",
    description: "Расписание ЭИОС, домашка, мероприятия и музыка для первокурсников Высшей IT-школы КГУ.",
    url: "/",
    siteName: "by pogostik",
    locale: "ru_RU",
    type: "website",
    images: [{ url: "/og.png", width: 1536, height: 1024, alt: "by pogostik — учебный хаб" }],
  },
  twitter: { card: "summary_large_image", title: "by pogostik", description: "Учёба без хаоса", images: ["/og.png"] },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ru"><body>{children}</body></html>;
}
