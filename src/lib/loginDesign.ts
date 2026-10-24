import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useState } from "react";

import {
  DEFAULT_DESIGN_CONFIG,
  parsePublicDesignConfig,
  resolveDesignConfig,
  serializeDesignConfig,
  type PublicDesignConfig,
} from "../../shared/brand/config";
import { supabase } from "@/lib/supabase";

const CACHE_KEY = "peakpic.loginDesign";
/** The login screen never waits longer than this for the design (it shows the last copy meanwhile). */
const TIMEOUT_MS = 2500;

async function readCache(): Promise<PublicDesignConfig | null> {
  try {
    const stored = await AsyncStorage.getItem(CACHE_KEY);
    return stored === null ? null : parsePublicDesignConfig(JSON.parse(stored));
  } catch {
    return null;
  }
}

/** The current design from the server (checked), or null on error, timeout or a broken answer. */
async function fetchRemote(): Promise<PublicDesignConfig | null> {
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), TIMEOUT_MS));
  const request = supabase
    .rpc("get_public_design_config", {})
    .then(({ data, error }) => (error ? null : parsePublicDesignConfig(data)))
    .then((config) => config, () => null);
  const config = await Promise.race([request, timeout]);
  if (config !== null) void AsyncStorage.setItem(CACHE_KEY, serializeDesignConfig(config)).catch(() => undefined);
  return config;
}

/**
 * Design of the login screen: starts with the built-in defaults, then the last local copy, then
 * the server's answer. Never blocks the screen; offline the copy (or the defaults) stays.
 */
export function useLoginDesign(): PublicDesignConfig {
  const [config, setConfig] = useState<PublicDesignConfig>(DEFAULT_DESIGN_CONFIG);

  useEffect(() => {
    let active = true;
    let fresh = false;
    void readCache().then((cached) => {
      if (active && !fresh && cached !== null) setConfig(resolveDesignConfig(null, cached));
    });
    void fetchRemote().then((remote) => {
      if (!active || remote === null) return;
      fresh = true;
      setConfig(remote);
    });
    return () => {
      active = false;
    };
  }, []);

  return config;
}
