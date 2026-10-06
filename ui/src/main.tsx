import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/cairo/wght.css";
import "./index.css";
import { MotionConfig } from "motion/react";
import App from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {/* "user": animations that move things are reduced or skipped when Windows asks for less motion */}
    <MotionConfig reducedMotion="user">
      <App />
    </MotionConfig>
  </StrictMode>,
);
