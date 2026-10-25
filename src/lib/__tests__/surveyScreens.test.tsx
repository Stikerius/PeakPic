import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { ReactElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

/* eslint-disable @typescript-eslint/no-require-imports -- jest mock factories and late imports */
import "react-native-gesture-handler/jestSetup";

import { ThemeProvider } from "@/lib/theme";

jest.mock("react-native-reanimated", () => ({ ...require("react-native-reanimated/mock"), useReducedMotion: () => false }));
jest.mock("react-native-safe-area-context", () => require("react-native-safe-area-context/jest/mock").default);
jest.mock("react-native-worklets", () => require("react-native-worklets/lib/module/mock"));
jest.mock("@react-native-async-storage/async-storage", () => require("@react-native-async-storage/async-storage/jest/async-storage-mock"));

const mockBack = jest.fn();
jest.mock("expo-router", () => {
  const Stack = function MockStack() {
    return null;
  };
  Stack.Screen = function MockScreen() {
    return null;
  };
  return {
    Stack,
    router: { push: jest.fn(), back: () => mockBack() },
    useLocalSearchParams: () => ({ surveyId: "11111111-1111-4111-8111-111111111111" }),
  };
});

jest.mock("@/lib/photoUpload", () => ({ getSignedPhotoUrl: () => Promise.resolve(null) }));

const mockRepo = {
  fetchOfficialProfile: jest.fn(),
  fetchOfficialProfileItems: jest.fn(),
  fetchSurvey: jest.fn(),
  submitSurvey: jest.fn(),
  trackSurveyEvent: jest.fn(),
  signSurveyMedia: () => Promise.resolve(new Map()),
};
jest.mock("@/lib/surveyRepo", () => mockRepo);
jest.mock("@/lib/usage", () => ({ track: jest.fn(), isUsageEnabled: () => true }));

// Imported after the mocks.
const { OfficialProfileView } = require("@/components/surveys/official-profile") as typeof import("@/components/surveys/official-profile");
const SurveyScreen = (require("@/app/survey/[surveyId]") as { default: () => ReactElement }).default;
const { Alert } = require("react-native") as typeof import("react-native");

const flush = () => act(() => new Promise((r) => setTimeout(r, 0)));
const allText = (tree: ReactTestRenderer) =>
  tree.root
    .findAll((n) => typeof n.type === "string" && (n.type as string) === "Text")
    .map((n) => (n.children as unknown[]).filter((c) => typeof c === "string").join(""))
    .join(" | ");
const press = async (tree: ReactTestRenderer, label: string) => {
  const target = tree.root.findAll((n) => n.props.accessibilityLabel === label && typeof n.props.onPress === "function")[0]
    ?? tree.root.findAll((n) => typeof n.props.onPress === "function" && n.findAll((c) => typeof c.type === "string" && (c.children as unknown[]).includes(label)).length > 0).at(-1);
  if (target === undefined) throw new Error(`no button "${label}"`);
  await act(async () => target.props.onPress());
};

const survey = {
  surveyId: "11111111-1111-4111-8111-111111111111",
  title: "Wie gefällt dir PeakPic?",
  topic: "Wir möchten wissen, was dir gefällt.",
  state: "active",
  endsAt: new Date(Date.now() + 3 * 86400e3).toISOString(),
  allowText: false,
  answered: false,
  media: [],
  questions: [{ id: "q1", kind: "yes_no", prompt: "Gefällt dir die App?", required: true, options: null, maxChoices: null, scaleMin: null, scaleMax: null, textMax: null }],
};

let alertSpy: ReturnType<typeof jest.spyOn>;
beforeEach(() => {
  jest.clearAllMocks();
  // Confirm every dialog with its last button ("Abschicken", "Verlassen").
  alertSpy = jest.spyOn(Alert, "alert").mockImplementation((_t, _m, buttons) => {
    const last = buttons?.[buttons.length - 1];
    last?.onPress?.();
  });
});
afterEach(() => alertSpy.mockRestore());

describe("official profile", () => {
  it("shows name, badge, description and the two tabs; never chat, follow, followers or blocking", async () => {
    mockRepo.fetchOfficialProfile.mockImplementation(() =>
      Promise.resolve({ userId: "o", username: "peakpic", displayName: "PeakPic", avatarPath: null, bio: "Umfragen des Teams.", surveyCount: 1, resultsCount: 0 }),
    );
    mockRepo.fetchOfficialProfileItems.mockImplementation(() => Promise.resolve([]));
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = create(
        <ThemeProvider>
          <OfficialProfileView />
        </ThemeProvider>,
      );
    });
    await flush();
    const text = allText(tree);
    expect(text).toContain("PeakPic");
    expect(text).toContain("Offiziell");
    expect(text).toContain("Umfragen des Teams.");
    expect(text).toContain("Umfragen (1)");
    expect(text).toContain("Auswertungen (0)");
    expect(text).not.toMatch(/Nachricht|Folgen|Follower|Blockieren|E-Mail|Streak|Statistik/);
    expect(tree.root.findAll((n) => typeof n.props.accessibilityLabel === "string" && /Nachricht|Blockieren|Folgen/.test(n.props.accessibilityLabel))).toHaveLength(0);
  });
});

describe("taking part", () => {
  async function open() {
    mockRepo.fetchSurvey.mockImplementation(() => Promise.resolve(survey));
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = create(
        <ThemeProvider>
          <SurveyScreen />
        </ThemeProvider>,
      );
    });
    await flush();
    await press(tree, "Los geht's");
    await press(tree, "Ja");
    return tree;
  }

  it("network error: answers stay, 'Erneut senden'", async () => {
    mockRepo.submitSurvey.mockImplementation(() => Promise.reject(new TypeError("Network request failed")));
    const tree = await open();
    await press(tree, "Abschicken");
    await flush();
    const text = allText(tree);
    expect(text).toContain("deine Antworten bleiben erhalten");
    expect(text).toContain("Erneut senden");
    expect(mockRepo.submitSurvey).toHaveBeenCalledWith(survey.surveyId, { q1: true });
  });

  it("survey ended meanwhile: a plain message, nothing more is sent", async () => {
    mockRepo.submitSurvey.mockImplementation(() => Promise.reject({ message: "survey_not_active" }));
    const tree = await open();
    await press(tree, "Abschicken");
    await flush();
    expect(allText(tree)).toContain("Deine Antworten wurden nicht gesendet");
    expect(mockRepo.submitSurvey).toHaveBeenCalledTimes(1);
  });

  it("success: thanks", async () => {
    mockRepo.submitSurvey.mockImplementation(() => Promise.resolve());
    const tree = await open();
    await press(tree, "Abschicken");
    await flush();
    expect(allText(tree)).toContain("Danke für deine Teilnahme!");
  });
});
