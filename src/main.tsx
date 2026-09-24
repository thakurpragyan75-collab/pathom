import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { FathomApp } from "./components/fathom/fathom-app";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <FathomApp />
  </StrictMode>,
);
