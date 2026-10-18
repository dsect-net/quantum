import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { SingularityApp } from "./components/singularity/app";
import "./index.css";

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root");
createRoot(root).render(
  <StrictMode>
    <SingularityApp />
  </StrictMode>,
);

// Native wrappers do not use a browser service worker. Registration is best-effort.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  void navigator.serviceWorker.register('/sw.js').catch(() => {
    console.warn('Singularity offline shell is unavailable; online mode still works.');
  });
}
