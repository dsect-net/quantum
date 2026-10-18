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
