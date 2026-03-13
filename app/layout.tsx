import type { Metadata, Viewport } from "next"
import { Geist, Geist_Mono, IBM_Plex_Mono } from "next/font/google"
import "highlight.js/styles/github-dark-dimmed.css"
import "highlight.js/styles/github.css"
import "./globals.css"
import { Providers } from "@/components/providers/providers"

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
})

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
})

const ibmPlexMono = IBM_Plex_Mono({
  variable: "--font-ibm-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
})

export const metadata: Metadata = {
  title: "Dev Hub",
  description: "Personal development command center",
}

export const viewport: Viewport = {
  interactiveWidget: "resizes-content",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('dev-hub-theme')||'system';if(t==='dark')t='default-dark';if(t==='light')t='default-light';var d=document.documentElement;var c=[];switch(t){case 'catppuccin-mocha':c=['dark','catppuccin-mocha'];break;case 'catppuccin-macchiato':c=['dark','catppuccin-macchiato'];break;case 'catppuccin-frappe':c=['dark','catppuccin-frappe'];break;case 'catppuccin-latte':c=['light','catppuccin-latte'];break;case 'dracula':c=['dark','dracula'];break;case 'default-dark':c=['dark'];break;case 'default-light':c=['light'];break;default:c=[window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'];}c.forEach(function(cls){d.classList.add(cls)});}catch(e){}})()`,
          }}
        />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${ibmPlexMono.variable} antialiased`}
      >
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
