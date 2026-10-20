/** Quick reactions offered in the chat's reaction bar. */
export const QUICK_REACTIONS = ["👍", "❤️", "😂", "🔥", "💪"] as const;

const section = (title: string, emojis: string) => ({ title, emojis: emojis.split(" ") });

/** Emojis offered behind "…" in the reaction bar, grouped like a small emoji keyboard. */
export const EMOJI_SECTIONS = [
  section(
    "Smileys",
    "😀 😃 😄 😁 😆 😅 🤣 😂 🙂 😉 😊 😇 🥰 😍 🤩 😘 😋 😜 🤪 😎 🤓 🥳 😏 😌 😴 🤤 😮 😲 😳 🥺 😢 😭 😤 😠 😡 🤯 😱 🥵 🥶 🤔 🤫 🤭 🙄 😬 🤗 🫡 😵 🤢 🤮 🤒 💀 🤡 👻 😈",
  ),
  section("Gesten", "👍 👎 👌 🤌 ✌️ 🤞 🤟 🤘 🤙 👋 👏 🙌 🫶 👐 🙏 🤝 💪 🦵 👊 ✊ 🤛 🤜 ☝️ 👆 👇 👉 👈 🫵 👀 🧠"),
  section("Herzen", "❤️ 🧡 💛 💚 💙 💜 🖤 🤍 🤎 💖 💗 💓 💞 💕 💘 💔 ❣️ 💯 💥 💫 ✨ ⭐ 🌟 🔥"),
  section("Sport", "🏋️ 🤸 🏃 🚴 🏊 🧗 🤾 ⛹️ 🧘 🥊 🥋 ⚽ 🏀 🏈 ⚾ 🎾 🏐 🏓 🏸 🥅 ⛳ 🏆 🥇 🥈 🥉 🎯 ⏱️ 👟 🎽"),
  section("Essen", "🍎 🍌 🍓 🥑 🥦 🥕 🍗 🥩 🍳 🥚 🍕 🍔 🍟 🌮 🍣 🍝 🥗 🍫 🍩 🍪 🍦 ☕ 🥤 🍺 🍷 🥛 💧"),
  section("Natur", "☀️ 🌙 ⛅ 🌧️ ❄️ ⚡ 🌈 🌊 🏔️ 🌲 🌸 🌻 🍀 🐶 🐱 🦁 🐻 🐼 🐸 🐵 🦄 🐝 🦋 🐢"),
  section("Symbole", "✅ ❌ ❗ ❓ ⚠️ 🚀 🎉 🎊 🎁 🎶 📸 📈 📉 ⏰ 🔔 💤 💬 👑 💎 💰"),
];
