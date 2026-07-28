import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../index.css";
import ViewerApp from "./ViewerApp.tsx";

// Align the page chrome with the site accent (the app default is emerald).
document.documentElement.style.setProperty("--color-accent", "#00a99d");
document.documentElement.style.setProperty(
	"--color-accent-soft",
	"rgba(0, 169, 157, 0.1)",
);
document.documentElement.style.setProperty(
	"--color-accent-border",
	"rgba(0, 169, 157, 0.25)",
);

const root = document.getElementById("root");
if (!root) throw new Error("Root element not found");
createRoot(root).render(
	<StrictMode>
		<ViewerApp />
	</StrictMode>,
);
