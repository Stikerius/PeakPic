import { createContext, use, useCallback, useEffect, useState, type ReactNode } from "react";

import { fetchDashboardLogo } from "./api";
import { APP_LOGO_SPEC, STANDARD_PARAMS, type BrandMode, type BrandPaletteName } from "./brand";

export type DashboardBrand = {
  /** Active logo of the target "dashboard" (checked again when drawn). */
  spec: unknown;
  params: unknown;
  palette: BrandPaletteName;
  mode: BrandMode;
  /** Load again (after a logo was activated). */
  reload: () => void;
};

const BrandContext = createContext<DashboardBrand | null>(null);

/**
 * The dashboard's logo comes from the library (public read, also before signing in), never from a
 * local choice. Until it is loaded, and if loading fails, the built-in app logo is shown.
 */
export function DashboardBrandProvider({ mode, palette, children }: { mode: BrandMode; palette: BrandPaletteName; children: ReactNode }) {
  const [logo, setLogo] = useState<{ spec: unknown; params: unknown }>({ spec: APP_LOGO_SPEC, params: STANDARD_PARAMS });
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let active = true;
    void fetchDashboardLogo().then((result) => {
      if (active && result !== null) setLogo(result);
    });
    return () => {
      active = false;
    };
  }, [version]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);
  return <BrandContext value={{ ...logo, palette, mode, reload }}>{children}</BrandContext>;
}

export function useDashboardBrand(): DashboardBrand {
  const brand = use(BrandContext);
  if (brand === null) throw new Error("useDashboardBrand must be used inside <DashboardBrandProvider>");
  return brand;
}
