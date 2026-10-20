import {
  ColorMatrix,
  Group,
  ImageFormat,
  Image as SkiaImage,
  Skia,
  drawAsImage,
  matchFont,
} from "@shopify/react-native-skia";
import { File, Paths } from "expo-file-system";
import { Platform } from "react-native";

import { OverlayDrawing, type MediaOverlay, type OverlayFonts } from "@/components/media-editor/overlay";
import { STORY_FILTERS } from "@/lib/storyFilters";

const EXPORT_JPEG_QUALITY = 92;
const FONT_FAMILY = Platform.select({ ios: "Helvetica Neue", default: "sans-serif" });

/** One photo in the editor: the original file plus its (not yet applied) edits. */
export type EditedPhoto = {
  key: string;
  uri: string;
  filterIndex: number;
  /** Text and mention overlays, in canvas coordinates. */
  items: MediaOverlay[];
};

export type CanvasSize = { width: number; height: number };

export function createEditedPhoto(uri: string): EditedPhoto {
  return { key: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, uri, filterIndex: 0, items: [] };
}

export function overlayFonts(): OverlayFonts {
  return {
    text: matchFont({ fontFamily: FONT_FAMILY, fontSize: 30, fontWeight: "bold" }),
    mention: matchFont({ fontFamily: FONT_FAMILY, fontSize: 24, fontWeight: "bold" }),
  };
}

export function filterOf(photo: EditedPhoto) {
  return STORY_FILTERS[photo.filterIndex] ?? STORY_FILTERS[0];
}

/**
 * Burns filter and overlays into a JPEG and returns its file URI. Rendered offscreen with
 * Skia, so photos that aren't on screen (other carousel pages) can be exported too.
 * The canvas is scaled up so the exported photo is `outputWidth` pixels wide.
 */
export async function renderEditedPhoto(
  photo: EditedPhoto,
  size: CanvasSize,
  fonts: OverlayFonts,
  outputWidth: number,
): Promise<string> {
  const image = Skia.Image.MakeImageFromEncoded(await Skia.Data.fromURI(photo.uri));
  if (image === null) throw new Error("Bild konnte nicht gelesen werden.");
  const scale = outputWidth / size.width;
  const filter = filterOf(photo);
  const snapshot = await drawAsImage(
    <Group transform={[{ scale }]}>
      <SkiaImage image={image} x={0} y={0} width={size.width} height={size.height} fit="cover">
        {filter !== undefined && <ColorMatrix matrix={[...filter.matrix]} />}
      </SkiaImage>
      {photo.items.map((item) => (
        <OverlayDrawing key={item.id} item={item} fonts={fonts} />
      ))}
    </Group>,
    { width: Math.round(size.width * scale), height: Math.round(size.height * scale) },
  );
  if (snapshot === null) throw new Error("Bild konnte nicht erzeugt werden.");
  const file = new File(Paths.cache, `edited-${photo.key}-${Date.now()}.jpg`);
  file.create({ overwrite: true });
  file.write(snapshot.encodeToBytes(ImageFormat.JPEG, EXPORT_JPEG_QUALITY));
  return file.uri;
}
