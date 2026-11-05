"use client";

import { useEffect, useState } from "react";

// Temporary probe: what does the TV browser support, and do remote keys reach the page?
export default function TvCheck() {
  const [lines, setLines] = useState<string[]>([]);

  useEffect(() => {
    const send = (entry: Record<string, unknown>) => {
      setLines((l) => [JSON.stringify(entry), ...l].slice(0, 30));
      fetch("/api/tv-check", { method: "POST", body: JSON.stringify(entry) }).catch(() => {});
    };

    const style = document.createElement("style");
    style.textContent = "@layer probe { #layer-probe { color: rgb(0, 128, 0); } }";
    document.head.appendChild(style);
    const probe = document.getElementById("layer-probe");
    const supports = (s: string) => {
      try {
        return CSS.supports(s);
      } catch {
        return "throws";
      }
    };
    send({
      ua: navigator.userAgent,
      layer: probe ? getComputedStyle(probe).color === "rgb(0, 128, 0)" : "no probe",
      colorMix: supports("color: color-mix(in srgb, red, blue)"),
      oklab: supports("color: oklab(0 0 0)"),
      hover: matchMedia("(hover: hover)").matches,
      pointer: matchMedia("(pointer: fine)").matches ? "fine" : "coarse/none",
      screen: `${innerWidth}x${innerHeight}@${devicePixelRatio}`,
    });

    const onKey = (e: KeyboardEvent) => send({ keydown: e.key, keyCode: e.keyCode });
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  return (
    <div style={{ background: "#000", color: "#fff", minHeight: "100vh", padding: 32, fontSize: 22 }}>
      <h1 id="layer-probe" style={{ fontSize: 32 }}>
        TV check: press Up, Down, Left, Right, OK, Back and the red/green buttons
      </h1>
      <button style={{ fontSize: 24, padding: 12, margin: "16px 0" }}>Focus me</button>
      {lines.map((l, i) => (
        <div key={i} style={{ fontFamily: "monospace", fontSize: 18 }}>
          {l}
        </div>
      ))}
    </div>
  );
}
