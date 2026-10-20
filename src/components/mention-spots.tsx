import { Pressable, StyleSheet, View } from "react-native";

import { coverPoint, mentionTapBox } from "@/lib/overlayGeometry";

export type MentionSpot = { userId: string; username: string; x: number; y: number };

type MentionSpotsProps = {
  spots: MentionSpot[];
  /** Width / height of the canvas the positions are relative to. */
  imageAspect: number;
  /** Size of the view the photo is shown in (contentFit "cover"). */
  width: number;
  height: number;
  onPress: (userId: string) => void;
};

const HIT_SLOP = 12;

/**
 * Invisible tap areas over the @labels drawn on a photo. Rendered as a sibling ABOVE the
 * photo's own gestures (tap for next story, swipe …), so a tap on a label always opens the
 * profile – by user id, never by username.
 */
export function MentionSpots({ spots, imageAspect, width, height, onPress }: MentionSpotsProps) {
  if (spots.length === 0 || width === 0 || height === 0) return null;
  const shownWidth = width / height > imageAspect ? width : height * imageAspect;
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {spots.map((spot) => {
        const center = coverPoint(spot, imageAspect, { width, height });
        const box = mentionTapBox(center, spot.username, shownWidth);
        return (
          <Pressable
            key={`${spot.userId}-${spot.x}-${spot.y}`}
            onPress={() => onPress(spot.userId)}
            hitSlop={HIT_SLOP}
            accessibilityRole="button"
            accessibilityLabel={`Profil von ${spot.username}`}
            style={[styles.spot, box]}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  spot: {
    position: "absolute",
  },
});
