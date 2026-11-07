"use client";

import { useEffect, useState } from "react";

const KEY = "lgCheck";
const EVENT = "lgcheck-change";

/** The "Check it plays on my LG TV" tick, remembered in localStorage and shared across components. */
export function useLgCheck(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(false);

  useEffect(() => {
    const read = () => setOn(localStorage.getItem(KEY) === "1");
    read();
    window.addEventListener(EVENT, read);
    window.addEventListener("storage", read);
    return () => {
      window.removeEventListener(EVENT, read);
      window.removeEventListener("storage", read);
    };
  }, []);

  const set = (next: boolean) => {
    localStorage.setItem(KEY, next ? "1" : "0");
    window.dispatchEvent(new Event(EVENT));
  };

  return [on, set];
}
