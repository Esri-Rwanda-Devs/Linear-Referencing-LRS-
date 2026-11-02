import { createRoot } from "react-dom/client";
import App from "./app/App";
import AppProviders from "./app/providers";
import "./styles/tokens.css";
import "./styles/reset.css";
import "./styles/globals.css";
import "./styles/utilities.css";

createRoot(document.getElementById("root")).render(
  <AppProviders>
    <App />
  </AppProviders>
);
