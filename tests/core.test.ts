import { describe, it, expect } from "vitest";
import {
  newRun,
  transition,
  fire,
  reload,
  damage,
  moveWithCollisions,
  segmentBlocked,
  parseSave,
  encodeSave,
  seeded,
  generateHack,
  advanceHack,
  type Run,
} from "../src/core";
describe("mission state machine", () => {
  it("starts at the contact with full resources", () => {
    const s = newRun();
    expect(s.stage).toBe("contact");
    expect(s.health).toBe(100);
    expect(s.ammo).toBe(12);
  });
  it("rejects out-of-order mission events", () => {
    const s = newRun();
    expect(transition(s, "download")).toEqual(s);
    expect(transition(s, "extract")).toEqual(s);
  });
  it("supports both endings through the full mission", () => {
    for (const ending of ["broadcast", "sell"] as const) {
      let s = newRun();
      for (const e of ["talk", "hack", ending, "extract"] as const)
        s = transition(s, e);
      expect(s.stage).toBe("complete");
      expect(s.ending).toBe(ending);
      expect(s.credits).toBe(ending === "sell" ? 12000 : 2400);
    }
  });
  it("cannot award extraction credits twice", () => {
    let s: Run = { ...newRun(), stage: "escape", ending: "sell" };
    s = transition(s, "extract");
    expect(transition(s, "extract").credits).toBe(12000);
  });
  it("dead players cannot advance", () => {
    expect(transition({ ...newRun(), health: 0 }, "talk").stage).toBe(
      "contact",
    );
  });
});
describe("combat resources", () => {
  it("consumes a bullet and prevents dry fire underflow", () => {
    let s = newRun();
    for (let i = 0; i < 40; i++) s = fire(s);
    expect(s.ammo).toBe(0);
  });
  it("reloads only available ammunition without creating bullets", () => {
    const s = reload({ ...newRun(), ammo: 3, reserve: 4 });
    expect(s.ammo).toBe(7);
    expect(s.reserve).toBe(0);
  });
  it("clamps damage and ignores invalid values", () => {
    expect(damage(newRun(), 1000).health).toBe(0);
    expect(damage(newRun(), -10).health).toBe(100);
    expect(damage(newRun(), NaN).health).toBe(100);
  });
});
describe("collision and visibility", () => {
  const walls = [{ x: 2, z: 0, w: 2, d: 20 }];
  it("stops a moving circle at a wall", () => {
    const p = moveWithCollisions({ x: 0, z: 0 }, { x: 5, z: 0 }, walls, 0.3);
    expect(p.x).toBeGreaterThan(0.4);
    expect(p.x).toBeLessThan(0.71);
  });
  it("slides along walls", () => {
    const p = moveWithCollisions({ x: 0, z: 0 }, { x: 5, z: 4 }, walls, 0.3);
    expect(p.x).toBeGreaterThan(0.4);
    expect(p.x).toBeLessThan(0.71);
    expect(p.z).toBeCloseTo(4);
  });
  it("does not tunnel through thin geometry", () => {
    const p = moveWithCollisions(
      { x: 0, z: 0 },
      { x: 30, z: 0 },
      [{ x: 2, z: 0, w: 0.1, d: 4 }],
      0.3,
    );
    expect(p.x).toBeGreaterThan(1.3);
    expect(p.x).toBeLessThan(1.66);
  });
  it("detects cover between actors", () => {
    expect(segmentBlocked({ x: 0, z: 0 }, { x: 5, z: 0 }, walls)).toBe(true);
    expect(segmentBlocked({ x: 0, z: 14 }, { x: 5, z: 14 }, walls)).toBe(false);
  });
});
describe("save boundary", () => {
  it("round trips a versioned save", () => {
    const s = transition(newRun(), "talk");
    const parsed = parseSave(encodeSave(s, { x: 0, z: 18 }, 0.2));
    expect(parsed?.run.stage).toBe("relay");
    expect(parsed?.position.z).toBe(18);
  });
  it("rejects invalid JSON, foreign versions, impossible health and coordinates", () => {
    expect(parseSave("{")).toBeNull();
    expect(parseSave('{"version":99}')).toBeNull();
    expect(
      parseSave(encodeSave({ ...newRun(), health: 999 }, { x: 0, z: 0 }, 0)),
    ).toBeNull();
    expect(parseSave(encodeSave(newRun(), { x: 100000, z: 0 }, 0))).toBeNull();
  });
  it("rejects injected mission states and missing fields", () => {
    const raw = JSON.parse(encodeSave(newRun(), { x: 0, z: 0 }, 0));
    raw.run.stage = "admin";
    expect(parseSave(JSON.stringify(raw))).toBeNull();
    delete raw.run.health;
    expect(parseSave(JSON.stringify(raw))).toBeNull();
  });
});
describe("deterministic generation and hacking", () => {
  it("repeats a seeded world sequence", () => {
    const a = seeded(83),
      b = seeded(83);
    const sequence = Array.from({ length: 50 }, a);
    expect(sequence).toEqual(Array.from({ length: 50 }, b));
    expect(new Set(sequence).size).toBeGreaterThan(40);
    expect(sequence.every((n) => n >= 0 && n < 1)).toBe(true);
  });
  it("creates a solvable, distinct sequence with wrong-input reset", () => {
    const h = generateHack(7);
    expect(h.sequence).toHaveLength(4);
    expect(new Set(h.sequence).size).toBe(h.sequence.length);
    let progress = 0;
    for (const i of h.sequence) progress = advanceHack(h.sequence, progress, i);
    expect(progress).toBe(h.sequence.length);
    expect(advanceHack(h.sequence, 2, 99)).toBe(0);
  });
});
