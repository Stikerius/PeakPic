import { Redirect, useLocalSearchParams } from "expo-router";

import { useSession } from "@/lib/session";

/** Old route: activities are a tab of the profile now. */
export default function ActivitiesRedirect() {
  const { userId } = useLocalSearchParams<{ userId: string }>();
  const isMe = useSession().session?.user.id === userId;
  return isMe ? (
    <Redirect href={{ pathname: "/profile", params: { tab: "activities" } }} />
  ) : (
    <Redirect href={{ pathname: "/user/[userId]", params: { userId, tab: "activities" } }} />
  );
}
