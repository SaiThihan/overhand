import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { ThemeProvider } from "./app/theme";
import { UiProvider } from "./app/ui";
import { Toaster } from "./components/ui/sonner";
import { TooltipProvider } from "./components/ui/tooltip";
import { HOSTED } from "./lib/hosted";
import "./index.css";

// the hosted page (relay origin) gates the dashboard behind sign-in and a WebRTC connection; WebRTC code loads only there
const Hosted = lazy(() => import("./components/Hosted").then((m) => ({ default: m.Hosted })));

const root = document.getElementById("root");
if (!root) throw new Error("index.html has no #root");

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={new QueryClient()}>
      <ThemeProvider>
        <TooltipProvider delayDuration={300}>
          <UiProvider>
            {HOSTED ? (
              <Suspense fallback={null}>
                <Hosted>
                  <App />
                </Hosted>
              </Suspense>
            ) : (
              <App />
            )}
            <Toaster />
          </UiProvider>
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  </StrictMode>,
);
