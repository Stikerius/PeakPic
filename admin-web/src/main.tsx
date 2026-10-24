import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";
import { AppearanceProvider, applyInitialAppearance } from "./lib/appearanceContext";
import { AuthProvider } from "./lib/auth";
import "./styles.css";

const root = document.getElementById("root");
if (root === null) throw new Error("#root missing");

// Colours and style before the first render, so nothing flashes in the wrong mode.
applyInitialAppearance();

createRoot(root).render(
  <StrictMode>
    <AppearanceProvider>
      <AuthProvider>
        <App />
      </AuthProvider>
    </AppearanceProvider>
  </StrictMode>,
);
