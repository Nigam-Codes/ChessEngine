import React from "react";
import { createRoot } from "react-dom/client";
import ChessEngineLab from "./ChessEngineLab.jsx";
import "./index.css";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ChessEngineLab />
  </React.StrictMode>
);
