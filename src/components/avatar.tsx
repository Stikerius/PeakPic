import { Image } from "expo-image";
import { StyleSheet, Text, View } from "react-native";

import { makeStyles } from "@/lib/theme";

type AvatarProps = {
  uri: string | null;
  username: string;
  size: number;
};

export function Avatar({ uri, username, size }: AvatarProps) {
  const styles = useStyles();
  const dimensions = { width: size, height: size, borderRadius: size / 2 };
  if (uri !== null) {
    return (
      <Image
        source={{ uri }}
        style={[styles.image, dimensions]}
        contentFit="cover"
        transition={150}
        accessibilityLabel={`Profilbild von ${username}`}
      />
    );
  }
  return (
    <View style={[styles.placeholder, dimensions]} accessibilityLabel={`Profilbild von ${username}`}>
      <Text style={[styles.initial, { fontSize: size * 0.42 }]}>
        {username.charAt(0).toUpperCase() || "?"}
      </Text>
    </View>
  );
}

const useStyles = makeStyles(({ colors }) =>
  StyleSheet.create({
    image: {
      backgroundColor: colors.surfaceRaised,
    },
    placeholder: {
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.accentSoft,
    },
    initial: {
      color: colors.text,
      fontWeight: "700",
    },
  }),
);
