import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import "./index.css"
import App from "./App"
import { installErrorReporting } from "./app/errors"
import { applyTheme, watchTheme } from "./lib/theme"

installErrorReporting()
applyTheme()
watchTheme()

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
