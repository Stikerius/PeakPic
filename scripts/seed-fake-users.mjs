// Seeds fake users with workout posts, follows, likes and comments.
//
//   npm run seed        (= node --env-file=.env scripts/seed-fake-users.mjs)
//
// Uses only the public anon key from .env (same permissions as the app), so it
// requires "Confirm email" to be OFF in Supabase → Authentication → Email.
// Re-running is safe: existing fake users are signed in and skipped if they
// already have posts. Fake users follow each other and every existing real account.
import { createClient } from "@supabase/supabase-js";
import { deflateSync } from "node:zlib";

const PASSWORD = "PeakPic-Fake-2026!";
const TIME_ZONE = "Europe/Zurich";

/** streakDays: consecutive training days ending today (or yesterday if endsYesterday). */
const FAKE_USERS = [
  { username: "lena.lifts", hue: 12, streakDays: 12, endsYesterday: false },
  { username: "marco_runs", hue: 200, streakDays: 4, endsYesterday: true },
  { username: "sara.squats", hue: 280, streakDays: 31, endsYesterday: false },
  { username: "jonas.gym", hue: 140, streakDays: 2, endsYesterday: false },
  { username: "mia_moves", hue: 330, streakDays: 7, endsYesterday: false },
];

const CAPTIONS = [
  "Leg Day erledigt 🦵",
  "Neuer PR beim Kreuzheben! 💪",
  "Früh morgens im Gym, beste Zeit",
  "Push Day ✅",
  "Heute nur Cardio, aber durchgezogen",
  "Rücken und Bizeps 🔥",
  null,
  "Kurz aber intensiv",
  "Mit @lena.lifts trainiert",
  null,
];

const COMMENTS = ["Stark! 🔥", "Weiter so 💪", "Krass, Respekt!", "Morgen zusammen?", "Saubere Form 👌"];

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !anonKey) {
  console.error("EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY fehlen. Mit --env-file=.env starten.");
  process.exit(1);
}


// ---------------------------------------------------------------- helpers

function dayKey(date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type).value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function addDays(key, amount) {
  const [y, m, d] = key.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + amount));
  return date.toISOString().slice(0, 10);
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typeAndData = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData));
  return Buffer.concat([length, typeAndData, crc]);
}

function hslToRgb(h, s, l) {
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const k = (n + h / 30) % 12;
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return [f(0), f(8), f(4)];
}

/** 4:5 diagonal gradient PNG with soft stripes, so every placeholder photo looks a bit different. */
function makePlaceholderPng(hue, variant, width = 640, height = 800) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 3 + 1);
    raw[row] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const t = (x / width + y / height) / 2;
      const stripe = Math.sin((x + y + variant * 37) / 28) * 0.04;
      const [r, g, b] = hslToRgb((hue + t * 40 + variant * 9) % 360, 0.65, 0.28 + t * 0.3 + stripe);
      const i = row + 1 + x * 3;
      raw[i] = r;
      raw[i + 1] = g;
      raw[i + 2] = b;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // colour type: RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function fail(step, error) {
  if (error?.code === "over_email_send_rate_limit") {
    error = {
      ...error,
      message:
        'Supabase will Bestätigungsmails verschicken ("Confirm email" ist an) und das Mail-Limit ist erreicht. ' +
        "Schalte in Supabase → Authentication → Sign In / Providers → Email „Confirm email“ aus und starte das Skript erneut.",
    };
  }
  console.error(`\n✖ ${step} fehlgeschlagen:`);
  console.error(`  ${error?.message ?? error}`);
  if (error?.statusCode || error?.status) console.error(`  Status: ${error.statusCode ?? error.status}`);
  if (error?.code) console.error(`  Code: ${error.code}`);
  process.exit(1);
}

// ---------------------------------------------------------------- seeding

async function signInOrUp(fake) {
  const client = createClient(url, anonKey, { auth: { persistSession: false } });
  const email = `peakpic.fake.${fake.username.replace(/[^a-z0-9]/g, "")}@mailinator.com`;

  const signIn = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (!signIn.error) return { client, userId: signIn.data.user.id, created: false };

  const signUp = await client.auth.signUp({
    email,
    password: PASSWORD,
    options: { data: { username: fake.username } },
  });
  if (signUp.error) fail(`Registrierung von ${fake.username}`, signUp.error);
  if (!signUp.data.session) {
    fail(
      `Registrierung von ${fake.username}`,
      'Keine Session erhalten. Bitte in Supabase → Authentication → Sign In / Providers → Email "Confirm email" ausschalten und das Skript erneut starten.',
    );
  }
  return { client, userId: signUp.data.user.id, created: true };
}

async function seedPosts({ client, userId }, fake) {
  const { count, error: countError } = await client
    .from("posts")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);
  if (countError) fail(`Posts von ${fake.username} zählen`, countError);
  if ((count ?? 0) > 0) return [];

  const lastDay = fake.endsYesterday ? addDays(dayKey(new Date()), -1) : dayKey(new Date());
  const postIds = [];
  for (let i = 0; i < fake.streakDays; i++) {
    const day = addDays(lastDay, -i);
    const path = `${userId}/posts/seed-${day}.png`;
    const upload = await client.storage
      .from("photos")
      .upload(path, makePlaceholderPng(fake.hue, i), { contentType: "image/png", upsert: true });
    if (upload.error) fail(`Foto-Upload (${fake.username}, ${day})`, upload.error);

    const insert = await client
      .from("posts")
      .insert({
        user_id: userId,
        photo_path: path,
        caption: CAPTIONS[(i + fake.hue) % CAPTIONS.length],
        workout_date: day,
        // ~18:00 Zurich time on that day
        created_at: `${day}T16:${String(10 + (i % 50)).padStart(2, "0")}:00Z`,
      })
      .select("id")
      .single();
    if (insert.error) fail(`Post anlegen (${fake.username}, ${day})`, insert.error);
    postIds.push(insert.data.id);
    process.stdout.write(".");
  }
  return postIds;
}

/** 1–3 active portrait stories per fake user, unless they already have active ones. */
async function seedStories({ client, userId }, fake) {
  const { count, error: countError } = await client
    .from("stories")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gt("expires_at", new Date().toISOString());
  if (countError) fail(`Storys von ${fake.username} zählen`, countError);
  if ((count ?? 0) > 0) return 0;

  const amount = 1 + (fake.hue % 3);
  for (let i = 0; i < amount; i++) {
    const path = `${userId}/stories/seed-${Date.now()}-${i}.png`;
    const upload = await client.storage
      .from("photos")
      .upload(path, makePlaceholderPng((fake.hue + 180) % 360, i + 3, 450, 800), {
        contentType: "image/png",
        upsert: true,
      });
    if (upload.error) fail(`Story-Upload (${fake.username})`, upload.error);
    // Spread over the last few hours so the viewer shows different times.
    const createdAt = new Date(Date.now() - (amount - i) * 2 * 60 * 60 * 1000);
    const insert = await client.from("stories").insert({
      user_id: userId,
      photo_path: path,
      created_at: createdAt.toISOString(),
      expires_at: new Date(createdAt.getTime() + 24 * 60 * 60 * 1000).toISOString(),
    });
    if (insert.error) fail(`Story anlegen (${fake.username})`, insert.error);
  }
  return amount;
}

async function main() {
  console.log(`Seeding ${FAKE_USERS.length} Fake-User gegen ${new URL(url).host} …`);
  const sessions = [];
  for (const fake of FAKE_USERS) {
    const session = await signInOrUp(fake);
    process.stdout.write(`\n${session.created ? "＋" : "↻"} @${fake.username} `);
    const postIds = await seedPosts(session, fake);
    const storyCount = await seedStories(session, fake);
    sessions.push({ ...session, fake, postIds, storyCount });
  }

  // Everyone follows everyone, plus every real account (so you get followers right away).
  const fakeIds = new Set(sessions.map((s) => s.userId));
  const { data: allProfiles, error: profilesError } = await sessions[0].client
    .from("profiles")
    .select("id, username")
    .limit(100);
  if (profilesError) fail("Echte Konten suchen", profilesError);
  const realProfiles = allProfiles.filter((p) => !fakeIds.has(p.id));
  for (const s of sessions) {
    const targets = sessions.filter((o) => o.userId !== s.userId).map((o) => o.userId);
    targets.push(...realProfiles.map((p) => p.id));
    const { error } = await s.client
      .from("follows")
      .upsert(
        targets.map((id) => ({ follower_id: s.userId, following_id: id })),
        { ignoreDuplicates: true },
      );
    if (error) fail(`Folgen (@${s.fake.username})`, error);
  }

  // A few likes and comments on the newest posts of the others.
  for (const s of sessions) {
    for (const other of sessions) {
      if (other.userId === s.userId) continue;
      for (const [index, postId] of other.postIds.slice(0, 3).entries()) {
        await s.client
          .from("post_likes")
          .upsert({ post_id: postId, user_id: s.userId }, { ignoreDuplicates: true });
        if ((index + s.fake.hue) % 3 === 0) {
          await s.client.from("comments").insert({
            post_id: postId,
            user_id: s.userId,
            body: COMMENTS[(index + other.fake.hue) % COMMENTS.length],
          });
        }
      }
    }
  }

  console.log("\n\n✔ Fertig. Fake-User (Passwort für alle: " + PASSWORD + "):");
  for (const s of sessions) {
    console.log(`  @${s.fake.username.padEnd(12)} ${s.postIds.length} neue Posts, ${s.storyCount} neue Storys`);
  }
  if (realProfiles.length > 0) {
    console.log(`\nDie Fake-User folgen jetzt: ${realProfiles.map((p) => "@" + p.username).join(", ")}`);
  }
  console.log("Damit ihre Posts in deinem Feed erscheinen: Feed → Personen-Icon → Usernames suchen und folgen.");
}

main().catch((error) => fail("Seed", error));
