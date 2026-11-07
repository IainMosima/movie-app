import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import { Nav } from "@/components/nav";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Spaceflix - LAN Media Streamer",
  description: "Stream torrents in 4K on your local network",
};

// Runs before paint, plain ES5 so even old TV engines execute it.
// 0. Browsers too old for the React app (no Promise/fetch, or Chrome < 60 —
//    e.g. LG webOS 3) go to the plain /lite page; "?full=1" opts out.
// 1. Tags <html class="tv"> on TV browsers. Newer VIDAA (Chromium "Odin" with a
//    cursor) reports hover/fine-pointer like a laptop, so media queries alone
//    can't tell it's a TV.
// 2. Once per session, reports what this browser supports to /api/tv-check so
//    a TV visit shows up in data/tv-check.log without opening a special page.
const tvBootScript = `(function(){
var d=document.documentElement,ua=navigator.userAgent,cm=ua.match(/Chrome\\/(\\d+)/);
if((!window.Promise||!window.fetch||(cm&&+cm[1]<60))&&location.pathname!=="/lite"&&location.search.indexOf("full=1")<0){location.replace("/lite");return}
if(/tv|vidaa|hisense|odin|tizen|webos|netcast|viera|roku/i.test(ua))d.className+=" tv";
try{if(sessionStorage.getItem("tvbeacon"))return;sessionStorage.setItem("tvbeacon","1")}catch(e){}
window.addEventListener("load",function(){
function sup(q){try{return CSS.supports(q)}catch(e){return "err"}}
var bg="";try{bg=getComputedStyle(document.body).backgroundColor}catch(e){}
var r={ua:ua,tv:/(^| )tv( |$)/.test(d.className),path:location.pathname,
screen:innerWidth+"x"+innerHeight+"@"+devicePixelRatio,
hover:matchMedia("(hover: hover)").matches,pointerFine:matchMedia("(pointer: fine)").matches,
cssApplied:bg==="rgb(0, 0, 0)",bodyBg:bg,sheets:document.styleSheets.length,
colorMix:sup("color: color-mix(in srgb, red, blue)"),oklch:sup("color: oklch(0.5 0.1 100)"),
is:sup("selector(:is(a))"),translate:sup("translate: 1px"),property:!!(window.CSS&&CSS.registerProperty),
layer:typeof CSSLayerBlockRule!=="undefined"};
var x=new XMLHttpRequest();x.open("POST","/api/tv-check",true);x.send(JSON.stringify(r));
});
})();`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: tvBootScript }} />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-black text-white min-h-screen`}
      >
        <Nav />
        {children}
        <Toaster position="bottom-right" />
      </body>
    </html>
  );
}
