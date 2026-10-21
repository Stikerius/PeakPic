import { StyleSheet, View } from "react-native";

import { makeStyles } from "@/lib/theme";

type DividerProps = {
  /** Left inset, e.g. to line up with the text of a list row after its icon. */
  inset?: number;
};

/** Hairline between list rows and sections. */
export function Divider({ inset = 0 }: DividerProps) {
  const styles = useStyles();
  return <View style={[styles.divider, inset > 0 && { marginLeft: inset }]} />;
}

const useStyles = makeStyles(({ colors }) =>
  StyleSheet.create({
    divider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: colors.divider,
    },
  }),
);
