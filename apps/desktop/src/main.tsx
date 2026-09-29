import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import App from "./App";
import { PostHogProvider } from '@posthog/react'
import posthog from "posthog-js";
import { installErrorHandlers, posthogOptions, telemetryConfigured } from "./lib/telemetry";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { watchAppearance } from "./lib/settings";

// Text size, motion, contrast and focus preferences apply before first paint.
watchAppearance();
installErrorHandlers();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const options = posthogOptions as any;

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary where="app" fullScreen>
    {telemetryConfigured ? (
      <PostHogProvider apiKey={import.meta.env.VITE_PUBLIC_POSTHOG_KEY} options={options}>
        <App />
      </PostHogProvider>
    ) : (
      // No key configured (e.g. a source build): hand the provider the
      // uninitialised client so every capture() is a silent no-op.
      <PostHogProvider client={posthog}>
        <App />
      </PostHogProvider>
    )}
    </ErrorBoundary>
  </React.StrictMode>,
);
