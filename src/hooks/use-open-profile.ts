import { router } from "expo-router";

import { useSession } from "@/lib/session";

/** Opens someone's profile; your own goes to the profile tab. */
export function useOpenProfile(): (userId: string) => void {
  const myId = useSession().session?.user.id;
  return (userId: string) => {
    if (userId === myId) router.navigate("/profile");
    else router.push({ pathname: "/user/[userId]", params: { userId } });
  };
}
