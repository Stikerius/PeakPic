// Alert.alert in the browser: react-native-web ships it as an empty function, so every
// confirmation and action menu of the app would silently do nothing. On the web the app routes
// the calls into a queue that <WebDialogHost /> shows as a dialog (pure logic here, tested).

export type DialogButton = { text: string; style: "default" | "cancel" | "destructive"; onPress?: () => void };
export type Dialog = { id: number; title: string; message: string | null; buttons: DialogButton[] };

type RawButton = { text?: string; style?: string; onPress?: (value?: string) => void };

let nextId = 1;

/** Alert.alert's arguments as a dialog: at least an "OK" button, unknown styles as default. */
export function toDialog(title: unknown, message: unknown, buttons: unknown): Dialog {
  const list = Array.isArray(buttons) ? (buttons as RawButton[]) : [];
  const mapped: DialogButton[] = list
    .filter((b) => typeof b === "object" && b !== null)
    .map((b) => ({
      text: typeof b.text === "string" && b.text !== "" ? b.text : "OK",
      style: b.style === "cancel" || b.style === "destructive" ? b.style : "default",
      onPress: typeof b.onPress === "function" ? () => b.onPress?.() : undefined,
    }));
  return {
    id: nextId++,
    title: typeof title === "string" ? title : "",
    message: typeof message === "string" && message !== "" ? message : null,
    buttons: mapped.length > 0 ? mapped : [{ text: "OK", style: "default" }],
  };
}

/** Escape and a click outside: the cancel button, or the only button. Otherwise nothing. */
export function dismissButton(dialog: Dialog): DialogButton | null {
  return dialog.buttons.find((b) => b.style === "cancel") ?? (dialog.buttons.length === 1 ? (dialog.buttons[0] ?? null) : null);
}

/** Order as on iOS: the cancel button last, the others as given. */
export function orderedButtons(dialog: Dialog): DialogButton[] {
  return [...dialog.buttons.filter((b) => b.style !== "cancel"), ...dialog.buttons.filter((b) => b.style === "cancel")];
}

type Listener = (queue: readonly Dialog[]) => void;
let queue: Dialog[] = [];
const listeners = new Set<Listener>();

export function showDialog(dialog: Dialog): void {
  queue = [...queue, dialog];
  listeners.forEach((l) => l(queue));
}

export function closeDialog(id: number): void {
  queue = queue.filter((d) => d.id !== id);
  listeners.forEach((l) => l(queue));
}

export function subscribeDialogs(listener: Listener): () => void {
  listeners.add(listener);
  listener(queue);
  return () => listeners.delete(listener);
}
