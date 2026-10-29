// Pure simulation: no browser/renderer dependencies. Distances in metres; time in seconds.
export type Stage = "contact" | "relay" | "archive" | "escape" | "complete";
export type Ending = "broadcast" | "sell" | null;
export interface Run {
  stage: Stage;
  health: number;
  ammo: number;
  reserve: number;
  energy: number;
  credits: number;
  kills: number;
  elapsed: number;
  ending: Ending;
}
export interface Point {
  x: number;
  z: number;
}
export interface Collider extends Point {
  w: number;
  d: number;
}
export type MissionEvent =
  "talk" | "hack" | "download" | "broadcast" | "sell" | "extract";
export const newRun = (): Run => ({
  stage: "contact",
  health: 100,
  ammo: 12,
  reserve: 96,
  energy: 100,
  credits: 0,
  kills: 0,
  elapsed: 0,
  ending: null,
});
export function transition(s: Run, event: MissionEvent): Run {
  if (s.health <= 0) return s;
  if (s.stage === "contact" && event === "talk")
    return { ...s, stage: "relay" };
  if (s.stage === "relay" && event === "hack")
    return { ...s, stage: "archive" };
  if (s.stage === "archive" && (event === "broadcast" || event === "sell"))
    return { ...s, stage: "escape", ending: event };
  if (s.stage === "escape" && event === "extract")
    return {
      ...s,
      stage: "complete",
      credits: s.credits + (s.ending === "sell" ? 12000 : 2400),
    };
  return s;
}
export const fire = (s: Run): Run =>
  s.ammo > 0 && s.health > 0 ? { ...s, ammo: s.ammo - 1 } : s;
export function reload(s: Run): Run {
  const n = Math.min(12 - s.ammo, s.reserve);
  return { ...s, ammo: s.ammo + n, reserve: s.reserve - n };
}
export const damage = (s: Run, amount: number): Run =>
  Number.isFinite(amount) && amount > 0
    ? { ...s, health: Math.max(0, s.health - amount) }
    : s;
export function overlaps(p: Point, w: Collider, r = 0.32): boolean {
  const x = Math.max(w.x - w.w / 2, Math.min(p.x, w.x + w.w / 2));
  const z = Math.max(w.z - w.d / 2, Math.min(p.z, w.z + w.d / 2));
  return (p.x - x) ** 2 + (p.z - z) ** 2 < r * r;
}
export function moveWithCollisions(
  p: Point,
  delta: Point,
  walls: Collider[],
  radius = 0.32,
): Point {
  const steps = Math.max(
    1,
    Math.ceil(Math.hypot(delta.x, delta.z) / (radius * 0.65)),
  );
  let q = { ...p };
  for (let i = 0; i < steps; i++) {
    const x = { x: q.x + delta.x / steps, z: q.z };
    if (!walls.some((w) => overlaps(x, w, radius))) q = x;
    const z = { x: q.x, z: q.z + delta.z / steps };
    if (!walls.some((w) => overlaps(z, w, radius))) q = z;
  }
  return q;
}
// Liang–Barsky slab intersection: prevents guards seeing or shooting through cover.
export function segmentBlocked(a: Point, b: Point, walls: Collider[]): boolean {
  return walls.some((w) => {
    let lo = 0,
      hi = 1;
    for (const [o, d, min, max] of [
      [a.x, b.x - a.x, w.x - w.w / 2, w.x + w.w / 2],
      [a.z, b.z - a.z, w.z - w.d / 2, w.z + w.d / 2],
    ]) {
      if (Math.abs(d) < 1e-8) {
        if (o < min || o > max) return false;
      } else {
        let t0 = (min - o) / d,
          t1 = (max - o) / d;
        if (t0 > t1) [t0, t1] = [t1, t0];
        lo = Math.max(lo, t0);
        hi = Math.min(hi, t1);
        if (lo > hi) return false;
      }
    }
    return lo < 0.995 && hi > 0.005;
  });
}
export interface Save {
  run: Run;
  position: Point;
  yaw: number;
}
export function parseSave(s: string): Save | null {
  try {
    const v = JSON.parse(s);
    if (v.version !== 1 || !v.run || !v.position) return null;
    const r = v.run,
      p = v.position;
    if (
      !["contact", "relay", "archive", "escape", "complete"].includes(
        r.stage,
      ) ||
      ![null, "broadcast", "sell"].includes(r.ending)
    )
      return null;
    for (const [key, max] of Object.entries({
      health: 100,
      ammo: 12,
      reserve: 999,
      energy: 100,
      credits: 1000000,
      kills: 100,
      elapsed: 1000000,
    }))
      if (!Number.isFinite(r[key]) || r[key] < 0 || r[key] > max) return null;
    if (
      !Number.isInteger(r.ammo) ||
      !Number.isInteger(r.reserve) ||
      !Number.isInteger(r.kills)
    )
      return null;
    if ((r.stage === "escape" || r.stage === "complete") && r.ending === null)
      return null;
    if (
      !Number.isFinite(p.x) ||
      !Number.isFinite(p.z) ||
      Math.abs(p.x) > 65 ||
      p.z < -88 ||
      p.z > 85 ||
      !Number.isFinite(v.yaw)
    )
      return null;
    return {
      run: {
        stage: r.stage,
        health: r.health,
        ammo: r.ammo,
        reserve: r.reserve,
        energy: r.energy,
        credits: r.credits,
        kills: r.kills,
        elapsed: r.elapsed,
        ending: r.ending,
      },
      position: { x: p.x, z: p.z },
      yaw: v.yaw,
    };
  } catch {
    return null;
  }
}
export const encodeSave = (run: Run, position: Point, yaw: number) =>
  JSON.stringify({
    version: 1,
    run,
    position: { x: position.x, z: position.z },
    yaw,
  });
export function seeded(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function generateHack(seed: number) {
  const rng = seeded(seed);
  const cells = Array.from({ length: 16 }, (_, i) => i);
  for (let i = 15; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [cells[i], cells[j]] = [cells[j], cells[i]];
  }
  return { sequence: cells.slice(0, 4) };
}
export const advanceHack = (
  sequence: number[],
  progress: number,
  input: number,
) =>
  progress >= sequence.length
    ? progress
    : sequence[progress] === input
      ? progress + 1
      : 0;
export const OBJECTIVES = {
  contact: {
    x: 5,
    z: 32,
    title: "Meet the ghost",
    detail: "Find Iona at the noodle stand.",
  },
  relay: {
    x: -6,
    z: 2,
    title: "Cut the surveillance",
    detail: "Breach the street relay. [E] to connect.",
  },
  archive: {
    x: 0,
    z: -58,
    title: "Steal the Echo",
    detail: "Reach the archive at the north end.",
  },
  escape: {
    x: 0,
    z: 62,
    title: "Leave no trace",
    detail: "Return to the extraction vehicle.",
  },
  complete: {
    x: 0,
    z: 62,
    title: "Contract closed",
    detail: "The city will remember your choice.",
  },
} satisfies Record<Stage, Point & { title: string; detail: string }>;
