// The web-only files (*.web.ts/tsx), loaded directly: the dialog that replaces Alert.alert, the
// SVG story ring, local files and chat backgrounds in the browser. The native versions are
// covered by the other tests (and Jest resolves the native files, see the last test).
/* eslint-disable @typescript-eslint/no-require-imports -- the .web files are loaded by path */
import { afterAll, describe, expect, it, jest } from "@jest/globals";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

jest.mock("react-native-reanimated", () => ({ ...require("react-native-reanimated/mock"), useReducedMotion: () => false }));
jest.mock("react-native-worklets", () => require("react-native-worklets/lib/module/mock"));
jest.mock("@react-native-async-storage/async-storage", () => require("@react-native-async-storage/async-storage/jest/async-storage-mock"));
jest.mock("expo-image-manipulator", () => ({ ImageManipulator: { manipulate: jest.fn() }, SaveFormat: { JPEG: "jpeg" } }));

const { Alert } = require("react-native") as typeof import("react-native");
const nativeAlert = Alert.alert;
const { ThemeProvider } = require("@/lib/theme") as typeof import("@/lib/theme");
const { WebDialogHost } = require("@/components/web-dialog-host.web") as typeof import("@/components/web-dialog-host.web");
const { StoryRing } = require("@/components/stories/story-ring.web") as typeof import("@/components/stories/story-ring.web");
const { storyRingGradient } = require("@/constants/theme") as typeof import("@/constants/theme");

afterAll(() => {
  Alert.alert = nativeAlert;
});

const texts = (tree: ReactTestRenderer) =>
  tree.root
    .findAll((n) => typeof n.type === "string" && (n.type as string) === "Text")
    .map((n) => (n.children as unknown[]).filter((c) => typeof c === "string").join(""));

describe("WebDialogHost (Alert.alert in the browser)", () => {
  it("shows the dialog, runs the chosen button and closes", async () => {
    const onDelete = jest.fn();
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = create(
        <ThemeProvider>
          <WebDialogHost />
        </ThemeProvider>,
      );
    });
    expect(texts(tree)).toEqual([]);
    await act(async () => {
      Alert.alert("Beitrag löschen?", "Das kann nicht rückgängig gemacht werden.", [
        { text: "Abbrechen", style: "cancel" },
        { text: "Löschen", style: "destructive", onPress: onDelete },
      ]);
    });
    const shown = texts(tree);
    expect(shown).toContain("Beitrag löschen?");
    expect(shown).toContain("Das kann nicht rückgängig gemacht werden.");
    expect(tree.root.findAll((n) => n.props.accessibilityRole === "alertdialog").length).toBeGreaterThan(0);
    const button = tree.root.findAll((n) => n.props.accessibilityLabel === "Löschen" && typeof n.props.onPress === "function")[0];
    await act(async () => button?.props.onPress());
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(texts(tree)).toEqual([]);
    // Two in a row: one after the other.
    await act(async () => {
      Alert.alert("Erster");
      Alert.alert("Zweiter");
    });
    expect(texts(tree)).toContain("Erster");
    const ok = tree.root.findAll((n) => n.props.accessibilityLabel === "OK" && typeof n.props.onPress === "function")[0];
    await act(async () => ok?.props.onPress());
    expect(texts(tree)).toContain("Zweiter");
  });
});

describe("StoryRing (web, SVG)", () => {
  it("the gradient of unseen stories, a thin border colour when seen, nothing for none", async () => {
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = create(
        <ThemeProvider>
          <StoryRing size={64} state="unseen">
            {null}
          </StoryRing>
        </ThemeProvider>,
      );
    });
    const stops = tree.root.findAll((n) => n.props.stopColor !== undefined && typeof n.type !== "string");
    expect(stops.map((s) => s.props.stopColor)).toEqual([...storyRingGradient]);
    const circle = tree.root.findAll((n) => n.props.r !== undefined && typeof n.props.stroke === "string")[0];
    expect(circle?.props.stroke).toMatch(/^url\(#story-ring-/);
    expect(circle?.props.strokeWidth).toBe(3);
    await act(async () => {
      tree.update(
        <ThemeProvider>
          <StoryRing size={64} state="seen">
            {null}
          </StoryRing>
        </ThemeProvider>,
      );
    });
    const seen = tree.root.findAll((n) => n.props.r !== undefined && typeof n.props.stroke === "string")[0];
    expect(seen?.props.stroke).not.toMatch(/^url/);
    expect(seen?.props.strokeWidth).toBe(1.5);
    await act(async () => {
      tree.update(
        <ThemeProvider>
          <StoryRing size={64} state="none">
            {null}
          </StoryRing>
        </ThemeProvider>,
      );
    });
    expect(tree.root.findAll((n) => n.props.r !== undefined && typeof n.props.stroke === "string")).toHaveLength(0);
  });
});

describe("local files in the browser", () => {
  it("reads blob URLs with fetch and writes blob URLs", async () => {
    const { readFileBytes, writeTempJpeg } = require("@/lib/localFiles.web") as typeof import("@/lib/localFiles.web");
    const realFetch = globalThis.fetch;
    globalThis.fetch = jest.fn(async () => ({ ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer })) as unknown as typeof fetch;
    const create = jest.fn(() => "blob:local/1");
    const realUrl = URL.createObjectURL;
    URL.createObjectURL = create;
    try {
      expect(Array.from(await readFileBytes("blob:local/0"))).toEqual([1, 2, 3]);
      expect(writeTempJpeg(new Uint8Array([9]), "x.jpg")).toBe("blob:local/1");
      expect(create).toHaveBeenCalledTimes(1);
    } finally {
      globalThis.fetch = realFetch;
      URL.createObjectURL = realUrl;
    }
  });
});

describe("chat backgrounds in the browser", () => {
  it("read and delete only the own, valid entries", () => {
    const store = new Map<string, string>();
    const storage = {
      get length() {
        return store.size;
      },
      key: (i: number) => [...store.keys()][i] ?? null,
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    };
    const g = globalThis as unknown as { window?: { localStorage?: unknown } };
    const hadWindow = g.window;
    g.window = { ...(g.window ?? {}), localStorage: storage };
    try {
      const bg = require("@/lib/chatBackground.web") as typeof import("@/lib/chatBackground.web");
      const user = "11111111-1111-4111-8111-111111111111";
      const other = "22222222-2222-4222-8222-222222222222";
      store.set(`peakpic.chatBackground.chat-backgrounds/${user}/c1.jpg`, "data:image/jpeg;base64,AAAA");
      store.set(`peakpic.chatBackground.chat-backgrounds/${user}/c2.jpg`, "javascript:alert(1)");
      store.set(`peakpic.chatBackground.chat-backgrounds/${other}/c1.jpg`, "data:image/jpeg;base64,BBBB");
      expect(bg.getChatBackgroundUri(user, "c1")).toBe("data:image/jpeg;base64,AAAA");
      // Only JPEG data URLs are ever used as a picture.
      expect(bg.getChatBackgroundUri(user, "c2")).toBeNull();
      // A strange id never reads anything.
      expect(bg.getChatBackgroundUri("../x", "c1")).toBeNull();
      bg.deleteAllChatBackgrounds(user);
      expect([...store.keys()]).toEqual([`peakpic.chatBackground.chat-backgrounds/${other}/c1.jpg`]);
    } finally {
      g.window = hadWindow;
    }
  });
});

describe("native builds keep the native files", () => {
  it("the plain module names resolve to the native versions", () => {
    const { WebDialogHost: NativeHost } = require("@/components/web-dialog-host") as typeof import("@/components/web-dialog-host");
    expect(NativeHost()).toBeNull();
    const { useWebKeys } = require("@/hooks/use-web-keys") as typeof import("@/hooks/use-web-keys");
    expect(useWebKeys({}, true)).toBeUndefined();
    const { registerWebFonts } = require("@/lib/webFonts") as typeof import("@/lib/webFonts");
    expect(registerWebFonts()).toBeUndefined();
  });
});
