import React from "react";
import { createRoot } from "react-dom/client";
import ChessEngineLab from "./ChessEngineLab.jsx";
import AppChrome from "./AppChrome.jsx";
import { registerServiceWorker } from "./pwa.js";
import "./index.css";

registerServiceWorker();

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ChessEngineLab />
    <AppChrome />
  </React.StrictMode>
);
