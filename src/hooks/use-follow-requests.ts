import { useEffect, useState } from "react";
import { AppState } from "react-native";

import { onAppEvent } from "@/lib/events";
import { countFollowRequests } from "@/lib/socialRepo";

/** Number of open follow requests to me; refreshes on follow changes and app resume. */
export function useFollowRequestCount(): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let active = true;
    const reload = () => {
      countFollowRequests()
        .then((value) => {
          if (active) setCount(value);
        })
        .catch(() => undefined);
    };
    reload();
    const unsubscribe = onAppEvent("followChanged", reload);
    const appState = AppState.addEventListener("change", (state) => {
      if (state === "active") reload();
    });
    return () => {
      active = false;
      unsubscribe();
      appState.remove();
    };
  }, []);

  return count;
}
