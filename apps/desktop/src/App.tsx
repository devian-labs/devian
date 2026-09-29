import { useState, useEffect } from "react";
import "./App.css";
import Onboarding from "./screens/Onboarding";
import Dashboard from "./screens/Dashboard";
import { Toaster } from "@/components/ui/toaster";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { UpdaterNotification } from "@/components/UpdaterNotification";
import { PREF, readPref } from "@/lib/prefs";
import { track } from "@/lib/telemetry";
import { FeedbackHost } from "@/components/FeedbackDialog";
import { AppNotices } from "@/components/AppNotices";

type ScreenState = 'onboarding' | 'dashboard';

function App() {
  // No permissions gate: agent history lives in the home folder and process
  // info needs no special access, so the app is usable from the first launch.
  const [currentScreen, setCurrentScreen] = useState<ScreenState>(() =>
    readPref<boolean>(PREF.onboarded, false) ? 'dashboard' : 'onboarding'
  );
  useEffect(() => {
    track('screen_view', { screen: currentScreen });
  }, [currentScreen]);

  useEffect(() => {
    getCurrentWindow().setResizable(true).catch(console.error);
  }, []);

  return (
    <>
      {currentScreen === 'onboarding' && <Onboarding onComplete={() => setCurrentScreen('dashboard')} />}
      {currentScreen === 'dashboard' && <Dashboard />}
      <Toaster />
      <UpdaterNotification />
      <FeedbackHost />
      {currentScreen === 'dashboard' && <AppNotices />}
    </>
  );
}

export default App;
