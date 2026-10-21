import { ActionSheetIOS, Alert, Platform } from "react-native";

export type SheetAction = { label: string; destructive?: boolean; onPress: () => void };

/** Native action menu (iOS action sheet, alert elsewhere) with a cancel entry at the end. */
export function showActionSheet(title: string | undefined, actions: SheetAction[], onCancel?: () => void): void {
  if (Platform.OS === "ios") {
    const destructive = actions.flatMap((action, index) => (action.destructive === true ? [index] : []));
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title,
        options: [...actions.map((action) => action.label), "Abbrechen"],
        cancelButtonIndex: actions.length,
        destructiveButtonIndex: destructive,
      },
      (index) => {
        const action = actions[index];
        if (action !== undefined) action.onPress();
        else onCancel?.();
      },
    );
    return;
  }
  Alert.alert(title ?? "", undefined, [
    ...actions.map((action) => ({
      text: action.label,
      style: action.destructive === true ? ("destructive" as const) : ("default" as const),
      onPress: action.onPress,
    })),
    { text: "Abbrechen", style: "cancel", onPress: onCancel },
  ]);
}
