"use client";

import { useEffect } from "react";

interface PwaRegistrationProps {
  enabled?: boolean;
  serviceWorkerPath: string;
}

export function PwaRegistration({ enabled = true, serviceWorkerPath }: PwaRegistrationProps) {
  useEffect(() => {
    if (!enabled || !("serviceWorker" in navigator)) return;

    navigator.serviceWorker.register(serviceWorkerPath).catch((error: unknown) => {
      if (process.env.NODE_ENV !== "production") {
        console.warn("Service worker registration failed.", error);
      }
    });
  }, [enabled, serviceWorkerPath]);

  return null;
}

