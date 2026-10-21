import { useEffect, useState } from "react";

import { signedPhotoUrl } from "../lib/api";

/** Photo through a short-lived signed URL (fetched when shown, never cached). */
export function SignedImage({ path, alt }: { path: string; alt: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    signedPhotoUrl(path)
      .then((result) => {
        if (!active) return;
        setUrl(result);
        setFailed(result === null);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [path]);

  if (failed) return <div className="image-missing">Bild nicht verfügbar</div>;
  if (url === null) return <div className="image-missing">Lädt …</div>;
  return <img className="content-image" src={url} alt={alt} referrerPolicy="no-referrer" />;
}
