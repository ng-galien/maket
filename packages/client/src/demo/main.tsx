import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../index.css";
import "../site-theme.css";
import DemoApp from "./DemoApp.tsx";

const root = document.getElementById("root");
if (!root) throw new Error("Root element not found");
createRoot(root).render(
	<StrictMode>
		<DemoApp />
	</StrictMode>,
);
