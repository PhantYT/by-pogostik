import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "../../app/globals.css";
import Home from "../../app/page";

if (window.top !== window.self) {
  try {
    window.top?.location.replace(window.location.href);
  } catch {
    // Keep the document hidden when a sandboxed frame blocks top navigation.
  }
} else {
  document.documentElement.classList.remove("frame-protected");
}

const container = document.getElementById("root");

if (!container) {
  throw new Error("Root element was not found");
}

createRoot(container).render(
  <StrictMode>
    <Home />
  </StrictMode>,
);
