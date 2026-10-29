import "./style.css";
import * as T from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { City, type Actor } from "./world";
import { Sound } from "./audio";
import { UI, el, show, text } from "./ui";
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
  generateHack,
  advanceHack,
  OBJECTIVES,
  type Run,
  type Point,
  type MissionEvent,
} from "./core";

type Mode =
  | "menu"
  | "playing"
  | "paused"
  | "settings"
  | "manual"
  | "dialogue"
  | "hack"
  | "journal"
  | "map"
  | "ending";
interface Settings {
  quality: "low" | "balanced" | "high";
  sensitivity: number;
  volume: number;
  reducedMotion: boolean;
  assist: boolean;
}
const SAVE = "blackline.save.v1",
  PREFS = "blackline.settings.v1";
const app = el("app");
app.innerHTML = UI;
el("retry").addEventListener("click", () => location.reload());
const storage = {
  get(key: string) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string) {
    try {
      localStorage.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  },
};
const clamp = (n: number, min: number, max: number) =>
  Math.max(min, Math.min(max, n));
const touch = matchMedia("(pointer:coarse)").matches;
const fmtTime = (s: number) =>
  `${Math.floor(s / 60)
    .toString()
    .padStart(2, "0")}:${Math.floor(s % 60)
    .toString()
    .padStart(2, "0")}`;

class Game {
  renderer: T.WebGLRenderer;
  composer: EffectComposer;
  bloom: UnrealBloomPass;
  camera = new T.PerspectiveCamera(72, innerWidth / innerHeight, 0.055, 390);
  city: City;
  sound = new Sound();
  mode: Mode = "menu";
  run: Run = newRun();
  settings: Settings = {
    quality: touch ? "low" : "balanced",
    sensitivity: 1,
    volume: 0.35,
    reducedMotion: matchMedia("(prefers-reduced-motion:reduce)").matches,
    assist: false,
  };
  position: Point = { x: 0, z: 48 };
  yaw = 0;
  pitch = 0;
  vertical = 0;
  jumpVelocity = 0;
  keys = new Set<string>();
  pointerHeld = false;
  dragging = false;
  aiming = false;
  scanner = false;
  shotCooldown = 0;
  reloadTimer = 0;
  flash = 0;
  hitMarker = 0;
  toastTimer = 0;
  subtitleTimer = 0;
  hitFlash = 0;
  clock = 0;
  last = performance.now();
  hudTimer = 0;
  fps = 60;
  hudHidden = false;
  hackSequence: number[] = [];
  hackProgress = 0;
  settingsReturn: Mode = "menu";
  manualReturn: Mode = "menu";
  audioWasOn = false;
  private ray = new T.Raycaster();
  private direction = new T.Vector3();
  private vector = new T.Vector3();
  private target: Actor | null = null;
  private mapContext: CanvasRenderingContext2D;
  private fullContext: CanvasRenderingContext2D;
  private touchMove = { x: 0, y: 0 };
  private lookTouch: number | null = null;
  private lookLast = { x: 0, y: 0 };
  private previousFocus: HTMLElement | null = null;
  private uiUpdateCount = 0;
  private suppressLookUntil = 0;
  private qualityTimer = 0;
  constructor() {
    const stored = storage.get(PREFS);
    if (stored) {
      try {
        const p = JSON.parse(stored);
        if (["low", "balanced", "high"].includes(p.quality))
          this.settings.quality = p.quality;
        for (const [k, min, max] of [
          ["sensitivity", 0.25, 2],
          ["volume", 0, 1],
        ] as const)
          if (Number.isFinite(p[k])) this.settings[k] = clamp(p[k], min, max);
        if (typeof p.reducedMotion === "boolean")
          this.settings.reducedMotion = p.reducedMotion;
        if (typeof p.assist === "boolean") this.settings.assist = p.assist;
      } catch {
        /* Ignore corrupt preferences. */
      }
    }
    this.renderer = new T.WebGLRenderer({
      canvas: el<HTMLCanvasElement>("world"),
      antialias: false,
      powerPreference: "high-performance",
      alpha: false,
    });
    this.renderer.setClearColor(0x121722);
    this.renderer.toneMapping = T.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.18;
    this.renderer.outputColorSpace = T.SRGBColorSpace;
    this.renderer.info.autoReset = false;
    this.camera.rotation.order = "YXZ";
    this.city = new City(this.camera);
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.city.scene, this.camera));
    this.bloom = new UnrealBloomPass(
      new T.Vector2(innerWidth, innerHeight),
      0.4,
      0.5,
      0.82,
    );
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.mapContext = el<HTMLCanvasElement>("minimap").getContext("2d")!;
    this.fullContext = el<HTMLCanvasElement>("fullmap").getContext("2d")!;
    this.syncSettings();
    this.applyQuality();
    this.events();
    this.updateContinue();
    this.animate(performance.now());
    void document.fonts.ready.then(() => {
      show("boot", false);
    });
    setTimeout(() => show("boot", false), 4000);
    el("start").focus();
    // Read-only telemetry, useful for diagnostics and automated smoke tests. No mutation API.
    Object.defineProperty(window, "blackline", {
      configurable: true,
      value: {
        snapshot: () => ({
          mode: this.mode,
          stage: this.run.stage,
          health: this.run.health,
          ammo: this.run.ammo,
          reserve: this.run.reserve,
          energy: this.run.energy,
          position: { ...this.position },
          yaw: this.yaw,
          pitch: this.pitch,
          fps: Math.round(this.fps),
          drawCalls: this.renderer.info.render.calls,
          triangles: this.renderer.info.render.triangles,
          alive: this.city.actors.filter((a) => a.hp > 0).length,
          kills: this.run.kills,
          elapsed: this.run.elapsed,
          target: this.target
            ? {
                id: this.target.id,
                hp: this.target.hp,
                stunned: this.target.stunned,
              }
            : null,
          actors: this.city.actors.map((a) => ({
            id: a.id,
            hp: a.hp,
            x: a.root.position.x,
            z: a.root.position.z,
          })),
          renderer: this.renderer
            .getContext()
            .getParameter(this.renderer.getContext().RENDERER),
        }),
      },
    });
  }
  private events() {
    const click = (id: string, fn: () => void) =>
      el(id).addEventListener("click", () => {
        this.sound.click();
        fn();
      });
    click("start", () => this.start(false));
    click("continue", () => this.start(true));
    click("resume", () => this.resume());
    click("open-settings", () => this.openSettings());
    click("pause-settings", () => this.openSettings());
    click("open-controls", () => {
      this.manualReturn = this.mode;
      this.open("manual");
    });
    click("settings-done", () => this.closeSettings());
    click("save-quit", () => {
      this.save();
      this.menu();
    });
    click("replay", () => this.start(false));
    click("ending-menu", () => this.menu());
    click("touch-pause", () => this.pause());
    click("sound-toggle", () => {
      if (this.sound.enabled) {
        this.sound.mute();
        text("sound-toggle", "SOUND OFF");
      } else {
        void this.sound
          .init()
          .then(() =>
            text(
              "sound-toggle",
              this.sound.enabled ? "SOUND ON" : "AUDIO BLOCKED",
            ),
          );
      }
    });
    document
      .querySelectorAll<HTMLButtonElement>("[data-close]")
      .forEach((b) =>
        b.addEventListener("click", () => this.closeModal(b.dataset.close!)),
      );
    el<HTMLSelectElement>("quality").addEventListener("change", () => {
      this.settings.quality = el<HTMLSelectElement>("quality")
        .value as Settings["quality"];
      this.applyQuality();
      this.persistSettings();
    });
    el<HTMLInputElement>("sensitivity").addEventListener("input", () => {
      this.settings.sensitivity = Number(
        el<HTMLInputElement>("sensitivity").value,
      );
      text("sensitivity-value", this.settings.sensitivity.toFixed(2));
      this.persistSettings();
    });
    el<HTMLInputElement>("volume").addEventListener("input", () => {
      this.settings.volume = Number(el<HTMLInputElement>("volume").value);
      this.sound.setVolume(this.settings.volume);
      text("volume-value", `${Math.round(this.settings.volume * 100)}%`);
      this.persistSettings();
    });
    el<HTMLInputElement>("reduced-motion").addEventListener("change", () => {
      this.settings.reducedMotion =
        el<HTMLInputElement>("reduced-motion").checked;
      this.applyQuality();
      this.persistSettings();
    });
    el<HTMLInputElement>("invincible").addEventListener("change", () => {
      this.settings.assist = el<HTMLInputElement>("invincible").checked;
      this.persistSettings();
    });
    window.addEventListener("resize", () => this.resize());
    window.addEventListener("keydown", (e) => {
      if (
        [
          "Space",
          "ArrowUp",
          "ArrowDown",
          "ArrowLeft",
          "ArrowRight",
          "Tab",
        ].includes(e.code) &&
        this.mode === "playing"
      )
        e.preventDefault();
      if (e.code === "Tab" && this.mode !== "playing" && this.mode !== "menu") {
        this.trapFocus(e);
        return;
      }
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLSelectElement
      )
        return;
      if (e.code === "Escape") {
        if (this.mode === "playing") this.pause();
        else if (this.mode === "paused") this.resume();
        else if (this.mode === "settings") this.closeSettings();
        else if (["manual", "journal", "map", "hack"].includes(this.mode))
          this.closeModal(this.mode);
        return;
      }
      this.keys.add(e.code);
      if (!e.repeat) this.action(e.code);
    });
    window.addEventListener("keyup", (e) => this.keys.delete(e.code));
    window.addEventListener("blur", () => {
      this.keys.clear();
      if (this.mode === "playing") this.pause();
    });
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        this.keys.clear();
        if (this.mode === "playing") this.pause();
      }
      this.last = performance.now();
    });
    document.addEventListener("pointerlockchange", () => {
      this.suppressLookUntil = performance.now() + 250;
      if (!document.pointerLockElement && this.mode === "playing" && !touch)
        this.pause();
    });
    document.addEventListener("pointerlockerror", () => {
      this.toast("Mouse capture unavailable. Hold click to look; F to fire.");
    });
    window.addEventListener("mousemove", (e) => {
      if (
        this.mode !== "playing" ||
        touch ||
        performance.now() < this.suppressLookUntil ||
        Math.abs(e.movementX) > 180 ||
        Math.abs(e.movementY) > 180
      )
        return;
      if (
        document.pointerLockElement === this.renderer.domElement ||
        this.dragging
      ) {
        this.yaw -= e.movementX * 0.002 * this.settings.sensitivity;
        this.pitch = clamp(
          this.pitch - e.movementY * 0.002 * this.settings.sensitivity,
          -1.42,
          1.42,
        );
      }
    });
    this.renderer.domElement.addEventListener("pointerdown", (e) => {
      if (this.mode !== "playing" || e.pointerType === "touch") return;
      if (e.button === 2) {
        this.aiming = true;
        return;
      }
      if (document.pointerLockElement) {
        this.shoot();
      } else {
        this.dragging = true;
        void this.lock();
      }
    });
    window.addEventListener("pointerup", () => {
      this.dragging = false;
      this.aiming = false;
    });
    this.renderer.domElement.addEventListener("contextmenu", (e) =>
      e.preventDefault(),
    );
    this.renderer.domElement.addEventListener("webglcontextlost", (e) => {
      e.preventDefault();
      this.pause();
      text(
        "fatal-message",
        "The graphics context was lost. Close other graphics-heavy tabs and reload. Your last checkpoint is saved.",
      );
      show("fatal");
    });
    this.renderer.domElement.addEventListener(
      "touchstart",
      (e) => {
        if (this.mode !== "playing") return;
        const p = e.changedTouches[0];
        if (p.clientX > innerWidth * 0.35) {
          this.lookTouch = p.identifier;
          this.lookLast = { x: p.clientX, y: p.clientY };
        }
      },
      { passive: true },
    );
    this.renderer.domElement.addEventListener(
      "touchmove",
      (e) => {
        if (this.mode !== "playing") return;
        for (const p of Array.from(e.changedTouches)) {
          if (p.identifier === this.lookTouch) {
            this.yaw -=
              (p.clientX - this.lookLast.x) * 0.004 * this.settings.sensitivity;
            this.pitch = clamp(
              this.pitch -
                (p.clientY - this.lookLast.y) *
                  0.004 *
                  this.settings.sensitivity,
              -1.42,
              1.42,
            );
            this.lookLast = { x: p.clientX, y: p.clientY };
          }
        }
        e.preventDefault();
      },
      { passive: false },
    );
    this.renderer.domElement.addEventListener(
      "touchend",
      () => (this.lookTouch = null),
    );
    const pad = el("touch-pad");
    const padMove = (e: PointerEvent) => {
      const r = pad.getBoundingClientRect();
      this.touchMove.x = clamp((e.clientX - r.left - r.width / 2) / 40, -1, 1);
      this.touchMove.y = clamp((e.clientY - r.top - r.height / 2) / 40, -1, 1);
      (pad.firstElementChild as HTMLElement).style.transform =
        `translate(${this.touchMove.x * 28}px,${this.touchMove.y * 28}px)`;
    };
    pad.addEventListener("pointerdown", (e) => {
      pad.setPointerCapture(e.pointerId);
      padMove(e);
    });
    pad.addEventListener("pointermove", (e) => {
      if (pad.hasPointerCapture(e.pointerId)) padMove(e);
    });
    for (const type of ["pointerup", "pointercancel", "lostpointercapture"])
      pad.addEventListener(type, () => {
        this.touchMove = { x: 0, y: 0 };
        (pad.firstElementChild as HTMLElement).style.transform = "";
      });
    document.querySelectorAll<HTMLButtonElement>("[data-touch]").forEach((b) =>
      b.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        if (b.dataset.touch === "fire") this.shoot();
        else this.action(b.dataset.touch!);
      }),
    );
    window.addEventListener("pagehide", () => {
      if (
        this.mode !== "menu" &&
        this.run.health > 0 &&
        this.run.stage !== "complete"
      )
        this.save();
    });
  }
  private trapFocus(e: KeyboardEvent) {
    const panel = document.querySelector<HTMLElement>(".overlay:not([hidden])");
    if (!panel) return;
    const focusables = Array.from(
      panel.querySelectorAll<HTMLElement>(
        "button:not([disabled]),input,select,a[href]",
      ),
    ).filter((x) => !x.hidden);
    const first = focusables[0],
      last = focusables.at(-1);
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last?.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first?.focus();
    }
  }
  private async lock() {
    if (touch) return;
    this.suppressLookUntil = performance.now() + 250;
    try {
      await this.renderer.domElement.requestPointerLock();
    } catch {
      this.toast("Hold click to look. Press F to fire.");
    }
  }
  private setMode(mode: Mode) {
    this.mode = mode;
    this.keys.clear();
    this.touchMove = { x: 0, y: 0 };
    document.body.classList.toggle(
      "in-game",
      mode !== "menu" &&
        !(mode === "manual" && this.manualReturn === "menu") &&
        !(mode === "settings" && this.settingsReturn === "menu"),
    );
    show("touch-controls", touch && mode === "playing");
  }
  private open(mode: Mode) {
    this.previousFocus = document.activeElement as HTMLElement;
    this.setMode(mode);
    if (document.pointerLockElement) document.exitPointerLock();
    show(mode === "paused" ? "pause" : mode);
    requestAnimationFrame(() =>
      document
        .querySelector<HTMLElement>(".overlay:not([hidden]) button")
        ?.focus(),
    );
  }
  private hideOverlays() {
    document
      .querySelectorAll<HTMLElement>(".overlay")
      .forEach((e) => (e.hidden = true));
  }
  private menu() {
    this.hideOverlays();
    this.setMode("menu");
    show("menu");
    show("hud", false);
    show("scanner-overlay", false);
    this.scanner = false;
    this.city.weapon.visible = false;
    this.updateContinue();
    el("start").focus();
  }
  private start(continued: boolean) {
    const save = continued ? parseSave(storage.get(SAVE) || "") : null;
    this.run = save?.run ?? newRun();
    this.position = save?.position ?? { x: 0, z: 48 };
    this.yaw = save?.yaw ?? 0;
    this.pitch = 0;
    this.vertical = 0;
    this.jumpVelocity = 0;
    this.city.resetActors();
    this.reloadTimer = 0;
    this.shotCooldown = 0;
    this.scanner = false;
    this.flash = 0;
    this.hitFlash = 0;
    this.hideOverlays();
    show("scanner-overlay", false);
    show("menu", false);
    show("hud");
    this.setMode("playing");
    this.sound.volume = this.settings.volume;
    void this.sound.init();
    this.camera.position.set(this.position.x, 1.72, this.position.z);
    this.camera.rotation.set(0, this.yaw, 0);
    this.save();
    this.updateHUD();
    this.subtitle(
      "IONA",
      continued
        ? "Signal restored. Pick up where you left off."
        : "East Ward. Ramen stand. Come alone, runner.",
      6,
    );
    void this.lock();
  }
  private pause() {
    if (this.mode !== "playing") return;
    this.open("paused");
  }
  private resume() {
    this.hideOverlays();
    this.setMode("playing");
    this.previousFocus?.blur();
    void this.lock();
  }
  private closeModal(id: string) {
    show(id, false);
    if (id === "manual") {
      this.setMode(this.manualReturn);
      if (this.manualReturn === "menu") {
        el("open-controls").focus();
        return;
      }
    } else if (id === "settings") {
      this.closeSettings();
      return;
    }
    this.resume();
  }
  private openSettings() {
    this.settingsReturn = this.mode === "paused" ? "paused" : "menu";
    if (this.mode === "paused") show("pause", false);
    this.open("settings");
  }
  private closeSettings() {
    show("settings", false);
    this.setMode(this.settingsReturn);
    if (this.settingsReturn === "paused") {
      show("pause");
      el("resume").focus();
    } else el("open-settings").focus();
  }
  private syncSettings() {
    el<HTMLSelectElement>("quality").value = this.settings.quality;
    el<HTMLInputElement>("sensitivity").value = String(
      this.settings.sensitivity,
    );
    el<HTMLInputElement>("volume").value = String(this.settings.volume);
    el<HTMLInputElement>("reduced-motion").checked =
      this.settings.reducedMotion;
    el<HTMLInputElement>("invincible").checked = this.settings.assist;
    text("sensitivity-value", this.settings.sensitivity.toFixed(2));
    text("volume-value", `${Math.round(this.settings.volume * 100)}%`);
  }
  private persistSettings() {
    storage.set(PREFS, JSON.stringify(this.settings));
  }
  private applyQuality() {
    const ratio =
      this.settings.quality === "high"
        ? Math.min(devicePixelRatio, 1.7)
        : this.settings.quality === "low"
          ? 0.5
          : Math.min(devicePixelRatio, 1);
    this.renderer.setPixelRatio(ratio);
    this.composer.setPixelRatio(ratio);
    this.bloom.enabled = this.settings.quality !== "low";
    this.bloom.strength = this.settings.quality === "high" ? 0.55 : 0.32;
    this.city.rain.visible =
      this.settings.quality !== "low" && !this.settings.reducedMotion;
    this.city.pedestrians.forEach(
      (p) => (p.visible = this.settings.quality !== "low"),
    );
    this.city.cars.forEach(
      (p) => (p.visible = this.settings.quality !== "low"),
    );
    this.qualityTimer = 0;
    this.resize();
  }
  private resize() {
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(innerWidth, innerHeight);
    this.composer.setSize(innerWidth, innerHeight);
  }
  private save() {
    if (this.run.health <= 0 || this.run.stage === "complete") return;
    const ok = storage.set(SAVE, encodeSave(this.run, this.position, this.yaw));
    if (!ok)
      this.toast("Browser storage unavailable. This run will not persist.");
    this.updateContinue();
  }
  private updateContinue() {
    const save = parseSave(storage.get(SAVE) || "");
    show(
      "continue",
      !!save && save.run.health > 0 && save.run.stage !== "complete",
    );
  }
  private action(code: string) {
    if (code === "F2") {
      this.hudHidden = !this.hudHidden;
      show("hud", !this.hudHidden && this.mode !== "menu");
      return;
    }
    if (this.mode !== "playing") return;
    if (code === "KeyE") this.interact();
    if (code === "KeyF") this.shoot();
    if (code === "KeyR") this.beginReload();
    if (code === "Space" && this.vertical <= 0.001) {
      this.jumpVelocity = 5;
    }
    if (code === "KeyV") {
      this.scanner = !this.scanner;
      show("scanner-overlay", this.scanner);
      this.sound.click();
    }
    if (code === "KeyQ") this.quickhack();
    if (code === "KeyH") {
      if (this.run.health >= 100) {
        this.toast("Vital signs already stable.");
        return;
      }
      if (this.run.energy < 25) {
        this.toast("Insufficient neural charge. Need 25.");
        return;
      }
      this.run = {
        ...this.run,
        health: Math.min(100, this.run.health + 40),
        energy: this.run.energy - 25,
      };
      this.sound.success();
      this.toast("MEDPATCH APPLIED / +40 VITALITY");
    }
    if (code === "KeyJ") {
      const stage = [
        "contact",
        "relay",
        "archive",
        "escape",
        "complete",
      ].indexOf(this.run.stage);
      el("journal-objectives").innerHTML = Object.entries(OBJECTIVES)
        .slice(0, 4)
        .map(
          ([, o], i) =>
            `<li><b>${i < stage ? "✓" : String(i + 1).padStart(2, "0")}</b><div>${o.title}<span>${o.detail}</span></div></li>`,
        )
        .join("");
      this.open("journal");
    }
    if (code === "KeyM") {
      this.open("map");
      this.drawMap(this.fullContext, true);
    }
  }
  private interact() {
    const o = OBJECTIVES[this.run.stage],
      dist = Math.hypot(this.position.x - o.x, this.position.z - o.z);
    if (dist > 3.25) {
      this.toast("Follow the lime diamond to the objective.");
      return;
    }
    if (this.run.stage === "contact") {
      this.dialogue(
        "IONA",
        "FIXER / EAST WARD",
        "Orison took my sister's memories as collateral. Then they sold the parts of her that made her human. Echo is the ledger. The street relay controls their eyes — crack it, then go north. The archive is under the tower. What you do with the truth is your call.",
        [
          {
            label: "01 / I’m in. Tell me where to start.",
            fn: () => {
              this.advance("talk");
              this.resume();
              this.subtitle(
                "IONA",
                "Relay 07. West side of the street. Stay low; patrols have short memories.",
                7,
              );
            },
          },
          {
            label: "02 / Why trust me with this?",
            fn: () => {
              text(
                "dialogue-copy",
                "Because you still ask why. Most runners only ask how much. Cut their surveillance, take the Echo ledger, and bring it back to the car. There is no clean way out — just a choice you can live with.",
              );
              el("dialogue-choices").firstElementChild?.scrollIntoView({
                block: "nearest",
              });
            },
          },
        ],
      );
    } else if (this.run.stage === "relay") this.openHack();
    else if (this.run.stage === "archive") {
      this.dialogue(
        "ECHO",
        "ORISON / UNREDACTED MEMORY LEDGER",
        "41,208 names. Every memory repossessed. Every life resold. Iona's sister is here. So are the buyers. A public broadcast will free the records — and make you a target. Orison will pay 12,000 credits for your silence. The transmission is yours.",
        [
          {
            label: "01 / BROADCAST — Give the memories back. [2,400 credits]",
            fn: () => this.chooseEnding("broadcast"),
          },
          {
            label: "02 / SELL — Take Orison’s offer. [12,000 credits]",
            fn: () => this.chooseEnding("sell"),
          },
        ],
      );
    } else if (this.run.stage === "escape") {
      this.advance("extract");
      this.end(false);
    }
  }
  private dialogue(
    name: string,
    role: string,
    copy: string,
    choices: { label: string; fn: () => void }[],
  ) {
    text("dialogue-title", name);
    text("dialogue-role", role);
    text("dialogue-copy", copy);
    const list = el("dialogue-choices");
    list.replaceChildren();
    for (const c of choices) {
      const b = document.createElement("button");
      b.textContent = c.label;
      b.addEventListener("click", () => {
        this.sound.click();
        c.fn();
      });
      list.append(b);
    }
    this.open("dialogue");
  }
  private chooseEnding(ending: "broadcast" | "sell") {
    this.advance(ending);
    this.resume();
    this.subtitle(
      ending === "broadcast" ? "IONA" : "ORISON",
      ending === "broadcast"
        ? "That's her. I remember her voice. Now get out — the car is south."
        : "Payment authorized upon extraction. Your discretion is appreciated. Return south.",
      8,
    );
  }
  private advance(event: MissionEvent) {
    const before = this.run.stage;
    this.run = transition(this.run, event);
    if (this.run.stage !== before) {
      this.sound.success();
      this.save();
      this.toast(
        this.run.stage === "escape"
          ? "ECHO SECURED / REACH EXTRACTION"
          : "CHECKPOINT SAVED / OBJECTIVE UPDATED",
      );
      this.updateHUD();
    }
  }
  private openHack() {
    this.hackSequence = generateHack(79).sequence;
    this.hackProgress = 0;
    const grid = el("hack-grid");
    grid.replaceChildren();
    for (let i = 0; i < 16; i++) {
      const b = document.createElement("button");
      b.textContent = i.toString(16).toUpperCase().padStart(2, "0");
      b.className = this.hackSequence.includes(i) ? "node" : "";
      b.setAttribute("aria-label", `Node ${b.textContent}`);
      b.addEventListener("click", () => this.hackInput(i));
      grid.append(b);
    }
    this.renderHack();
    this.open("hack");
  }
  private hackInput(input: number) {
    const next = advanceHack(this.hackSequence, this.hackProgress, input);
    this.hackProgress = next;
    this.sound.click();
    this.renderHack();
    if (next === 4) {
      text("hack-status", "ACCESS GRANTED");
      this.sound.hack();
      this.advance("hack");
      this.resume();
      this.subtitle(
        "IONA",
        "Their eyes are closed. The archive is north, under the Orison tower. Don't make a scene.",
        7,
      );
    } else text("hack-status", next === 0 ? "BUFFER RESET" : "NODE ACCEPTED");
  }
  private renderHack() {
    el("hack-sequence").innerHTML = this.hackSequence
      .map(
        (n, i) =>
          `<span class="${i < this.hackProgress ? "done" : ""}">${n.toString(16).toUpperCase().padStart(2, "0")}</span>`,
      )
      .join("");
    el("hack-buffer").innerHTML = Array.from(
      { length: 4 },
      (_, i) => `<i class="${i < this.hackProgress ? "filled" : ""}"></i>`,
    ).join("");
  }
  private beginReload() {
    if (this.reloadTimer > 0 || this.run.ammo === 12) return;
    if (this.run.reserve === 0) {
      this.toast("No reserve ammunition. Look for supply caches.");
      return;
    }
    this.reloadTimer = 1.25;
    this.sound.tone(250, 0.1, "triangle", 0.1);
  }
  private shoot() {
    if (
      this.mode !== "playing" ||
      this.shotCooldown > 0 ||
      this.reloadTimer > 0
    )
      return;
    if (this.run.ammo <= 0) {
      this.sound.tone(90, 0.05, "square", 0.08);
      this.shotCooldown = 0.2;
      this.toast("MAGAZINE EMPTY / R TO RELOAD");
      return;
    }
    this.run = fire(this.run);
    this.shotCooldown = 0.18;
    this.flash = 0.06;
    this.sound.shot();
    this.camera.updateMatrixWorld();
    this.ray.setFromCamera(new T.Vector2(), this.camera);
    this.ray.far = 70;
    const hits = this.ray.intersectObjects(this.city.targetMeshes, false);
    for (const hit of hits) {
      const a = hit.object.userData.actor as Actor;
      if (a.hp <= 0) continue;
      if (
        segmentBlocked(
          this.position,
          { x: hit.point.x, z: hit.point.z },
          this.city.walls,
        )
      )
        break;
      a.hp -= hit.point.y - a.root.position.y > 1.43 ? 70 : 38;
      a.alert = 1;
      this.hitMarker = 0.18;
      this.sound.hit();
      if (a.hp <= 0) this.kill(a);
      break;
    }
    this.alertNearby();
    this.updateHUD();
  }
  private kill(a: Actor) {
    a.hp = 0;
    a.root.rotation.z = Math.PI / 2;
    a.root.position.y = 0.22;
    this.run = {
      ...this.run,
      kills: this.run.kills + 1,
      reserve: Math.min(999, this.run.reserve + 8),
    };
    this.toast("SECURITY NEUTRALIZED / +8 AMMUNITION");
  }
  private alertNearby() {
    for (const a of this.city.actors)
      if (a.hp > 0 && a.root.position.distanceTo(this.camera.position) < 26)
        a.alert = 1;
  }
  private quickhack() {
    if (!this.target || this.target.hp <= 0) {
      this.toast("Aim at a security unit to quickhack.");
      return;
    }
    if (this.target.root.position.distanceTo(this.camera.position) > 28) {
      this.toast("Target outside neural range.");
      return;
    }
    if (
      segmentBlocked(this.position, this.target.root.position, this.city.walls)
    ) {
      this.toast("Quickhack blocked by cover.");
      return;
    }
    if (this.run.energy < 35) {
      this.toast("Insufficient neural charge. Need 35.");
      return;
    }
    this.run = { ...this.run, energy: this.run.energy - 35 };
    this.target.stunned = 7;
    this.target.hp -= 25;
    this.sound.hack();
    this.toast("NEURAL SHORT CIRCUIT / TARGET STUNNED 7S");
    if (this.target.hp <= 0) this.kill(this.target);
  }
  private updatePlayer(dt: number) {
    let f =
      Number(this.keys.has("KeyW") || this.keys.has("ArrowUp")) -
      Number(this.keys.has("KeyS") || this.keys.has("ArrowDown")) -
      this.touchMove.y;
    let r =
      Number(this.keys.has("KeyD") || this.keys.has("ArrowRight")) -
      Number(this.keys.has("KeyA") || this.keys.has("ArrowLeft")) +
      this.touchMove.x;
    const length = Math.hypot(f, r);
    if (length > 1) {
      f /= length;
      r /= length;
    }
    const crouch = this.keys.has("KeyC"),
      sprint = this.keys.has("ShiftLeft") || this.keys.has("ShiftRight"),
      speed = crouch ? 2.2 : sprint ? 8 : 4.7;
    const d = {
      x: (-Math.sin(this.yaw) * f + Math.cos(this.yaw) * r) * speed * dt,
      z: (-Math.cos(this.yaw) * f - Math.sin(this.yaw) * r) * speed * dt,
    };
    this.position = moveWithCollisions(this.position, d, this.city.walls, 0.32);
    this.position.x = clamp(this.position.x, -61, 61);
    this.position.z = clamp(this.position.z, -86, 83);
    this.jumpVelocity -= 13 * dt;
    this.vertical = Math.max(0, this.vertical + this.jumpVelocity * dt);
    if (this.vertical === 0) this.jumpVelocity = 0;
    const bob = this.settings.reducedMotion
      ? 0
      : Math.sin(this.run.elapsed * (sprint ? 15 : 10)) *
        Math.min(length, 1) *
        0.035;
    this.camera.position.set(
      this.position.x,
      (crouch ? 1.12 : 1.72) + this.vertical + bob,
      this.position.z,
    );
    this.camera.rotation.set(this.pitch, this.yaw, 0, "YXZ");
    const fov = this.aiming ? 51 : sprint && length > 0.1 ? 79 : 72;
    this.camera.fov = T.MathUtils.damp(this.camera.fov, fov, 9, dt);
    this.camera.updateProjectionMatrix();
    this.city.weapon.position.set(
      this.aiming ? 0.02 : 0.29,
      -0.24 + Math.sin(this.clock * 10) * Math.min(length, 1) * 0.007,
      -0.55 + this.shotCooldown * 0.24,
    );
    this.city.weapon.rotation.x =
      this.reloadTimer > 0
        ? -0.7 * Math.sin((this.reloadTimer / 1.25) * Math.PI)
        : this.shotCooldown * 0.22;
    if (this.reloadTimer > 0) {
      this.reloadTimer -= dt;
      if (this.reloadTimer <= 0) {
        this.run = reload(this.run);
        this.sound.tone(600, 0.08, "triangle", 0.09);
      }
    }
    this.run.energy = Math.min(100, this.run.energy + dt * 5);
    for (const p of this.city.pickups) {
      if (
        !p.taken &&
        Math.hypot(
          this.position.x - p.root.position.x,
          this.position.z - p.root.position.z,
        ) < 1.15
      ) {
        if (p.kind === "med" && this.run.health >= 100) continue;
        p.taken = true;
        p.root.visible = false;
        if (p.kind === "med")
          this.run.health = Math.min(100, this.run.health + 40);
        else this.run.reserve = Math.min(999, this.run.reserve + 36);
        this.sound.success();
        this.toast(
          p.kind === "med"
            ? "MEDPATCH / +40 VITALITY"
            : "SUPPLY CACHE / +36 AMMUNITION",
        );
      }
    }
  }
  private updateEnemies(dt: number) {
    for (const a of this.city.actors) {
      if (a.hp <= 0) continue;
      const pos = a.root.position,
        dist = Math.hypot(pos.x - this.position.x, pos.z - this.position.z);
      a.cooldown -= dt;
      if (a.stunned > 0) {
        a.stunned -= dt;
        a.root.rotation.z = Math.sin(this.clock * 15) * 0.08;
        continue;
      }
      a.root.rotation.z = 0;
      const visible =
        dist <
          (this.keys.has("KeyC")
            ? 11
            : this.run.stage === "relay" || this.run.stage === "contact"
              ? 23
              : 18) && !segmentBlocked(this.position, pos, this.city.walls);
      if (visible) a.alert = Math.min(1, a.alert + dt * 1.3);
      else a.alert = Math.max(0, a.alert - dt * 0.1);
      if (a.alert > 0.6) {
        a.root.lookAt(this.position.x, 0, this.position.z);
        if (dist > 7) {
          const dx =
              ((this.position.x - pos.x) / Math.max(dist, 0.1)) * dt * 1.6,
            dz = ((this.position.z - pos.z) / Math.max(dist, 0.1)) * dt * 1.6;
          const moved = moveWithCollisions(
            pos,
            { x: dx, z: dz },
            this.city.walls,
            0.35,
          );
          pos.x = moved.x;
          pos.z = moved.z;
        }
        if (visible && dist < 23 && a.cooldown <= 0) {
          a.cooldown = 1.25 + (a.id % 3) * 0.2;
          this.run = damage(this.run, this.settings.assist ? 2 : 7);
          this.hitFlash = 0.3;
          this.sound.hurt();
          if (this.run.health <= 0) {
            this.end(true);
            return;
          }
        }
      } else {
        const target = a.home.z + Math.sin(this.clock * 0.35 + a.phase) * 3;
        pos.z = T.MathUtils.damp(pos.z, target, 1, dt);
        a.root.rotation.y =
          Math.cos(this.clock * 0.35 + a.phase) > 0 ? 0 : Math.PI;
      }
      let leg = 0;
      a.root.children.forEach((c) => {
        if (c.name === "leg")
          c.rotation.x =
            Math.sin(this.clock * 5 + (leg++ % 2) * Math.PI) * 0.16;
      });
    }
  }
  private targetAtCentre() {
    this.camera.updateMatrixWorld();
    this.ray.setFromCamera(new T.Vector2(), this.camera);
    this.ray.far = 60;
    const hits = this.ray.intersectObjects(this.city.targetMeshes, false);
    this.target = null;
    for (const hit of hits) {
      const a = hit.object.userData.actor as Actor;
      if (
        a.hp > 0 &&
        !segmentBlocked(this.position, a.root.position, this.city.walls)
      ) {
        this.target = a;
        break;
      }
    }
    show("target-tag", !!this.target);
    if (this.target) {
      text(
        "target-name",
        this.target.stunned > 0 ? "NEURAL LINK DISABLED" : "ORISON / SECURITY",
      );
      el("target-health").style.width = `${this.target.hp}%`;
    }
  }
  private updateHUD() {
    const o = OBJECTIVES[this.run.stage],
      distance = Math.hypot(this.position.x - o.x, this.position.z - o.z);
    text("quest-title", o.title);
    text("quest-detail", o.detail);
    text(
      "quest-step",
      `${Math.min(
        4,
        ["contact", "relay", "archive", "escape", "complete"].indexOf(
          this.run.stage,
        ) + 1,
      )
        .toString()
        .padStart(2, "0")} / 04`,
    );
    text("distance", Math.round(distance));
    text("waypoint-distance", `${Math.round(distance)}m`);
    text("health", Math.ceil(this.run.health));
    text("energy", `${Math.round(this.run.energy)}%`);
    el("health-bar").style.width = `${this.run.health}%`;
    el("energy-bar").style.width = `${this.run.energy}%`;
    text("ammo", String(this.run.ammo).padStart(2, "0"));
    text("reserve", String(this.run.reserve).padStart(3, "0"));
    el("reload-status").innerHTML =
      this.reloadTimer > 0
        ? "RELOADING / PLEASE WAIT"
        : "SEMI-AUTO <span>·</span> <kbd>R</kbd> RELOAD";
    const alert = this.city.actors.some((a) => a.hp > 0 && a.alert > 0.6);
    text(
      "alert-level",
      alert
        ? "HOSTILES ALERTED"
        : this.scanner
          ? "SCANNER ACTIVE"
          : "SIGNAL CLEAN",
    );
    el("alert-level").style.color = alert ? "var(--red)" : "var(--cyan)";
    text(
      "district-label",
      this.position.z < -8
        ? "ORISON DISTRICT / SECURITY ZONE"
        : "ORISON DISTRICT / PUBLIC ACCESS",
    );
    const degrees = ((((this.yaw * -180) / Math.PI) % 360) + 360) % 360;
    text(
      "heading",
      ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][
        Math.round(degrees / 45) % 8
      ],
    );
    show("interaction", distance < 3.25);
    text(
      "interaction-text",
      this.run.stage === "contact"
        ? "TALK TO IONA"
        : this.run.stage === "relay"
          ? "BREACH RELAY"
          : this.run.stage === "archive"
            ? "ACCESS ECHO ARCHIVE"
            : "EXTRACT",
    );
    this.vector.set(o.x, 2.5, o.z);
    this.vector.project(this.camera);
    const behind =
      this.camera
        .getWorldDirection(this.direction)
        .dot(new T.Vector3(o.x - this.position.x, 0, o.z - this.position.z)) <
      0;
    const wx = clamp(
        (this.vector.x * 0.5 + 0.5) * innerWidth,
        35,
        innerWidth - 65,
      ),
      wy = behind
        ? innerHeight * 0.35
        : clamp(
            (-this.vector.y * 0.5 + 0.5) * innerHeight,
            100,
            innerHeight * 0.7,
          );
    el("waypoint").style.left = `${behind ? innerWidth * 0.5 : wx}px`;
    el("waypoint").style.top = `${wy}px`;
    show("waypoint", distance > 3.25);
    text(
      "telemetry",
      `${Math.round(this.fps)} FPS / ${this.settings.quality.toUpperCase()} / ${fmtTime(this.run.elapsed)}`,
    );
    this.targetAtCentre();
    this.drawMap(this.mapContext, false);
    this.uiUpdateCount++;
  }
  private drawMap(c: CanvasRenderingContext2D, full: boolean) {
    const w = c.canvas.width,
      h = c.canvas.height;
    c.fillStyle = "#081923";
    c.fillRect(0, 0, w, h);
    const scale = full ? Math.min(w / 112, h / 176) : 3.2,
      originX = full ? 0 : this.position.x,
      originZ = full ? -2 : this.position.z;
    const mx = (x: number) => w / 2 + (x - originX) * scale,
      mz = (z: number) => h / 2 + (z - originZ) * scale;
    c.strokeStyle = "#203944";
    c.lineWidth = 1;
    for (let x = -60; x <= 60; x += 10) {
      c.beginPath();
      c.moveTo(mx(x), 0);
      c.lineTo(mx(x), h);
      c.stroke();
    }
    for (let z = -90; z < 90; z += 10) {
      c.beginPath();
      c.moveTo(0, mz(z));
      c.lineTo(w, mz(z));
      c.stroke();
    }
    for (const wall of this.city.walls) {
      c.fillStyle = wall.w > 4 ? "#2c454f" : "#56717b";
      c.fillRect(
        mx(wall.x - wall.w / 2),
        mz(wall.z - wall.d / 2),
        wall.w * scale,
        wall.d * scale,
      );
    }
    c.strokeStyle = "#628389";
    c.setLineDash([5, 8]);
    c.beginPath();
    c.moveTo(mx(0), mz(-72));
    c.lineTo(mx(0), mz(80));
    c.stroke();
    c.setLineDash([]);
    for (const a of this.city.actors)
      if (
        a.hp > 0 &&
        (this.scanner ||
          full ||
          a.root.position.distanceTo(this.camera.position) < 18)
      ) {
        c.fillStyle = a.stunned > 0 ? "#66e5e5" : "#ff647f";
        c.beginPath();
        c.arc(
          mx(a.root.position.x),
          mz(a.root.position.z),
          full ? 4 : 3,
          0,
          Math.PI * 2,
        );
        c.fill();
      }
    for (const p of this.city.pickups)
      if (!p.taken) {
        c.fillStyle = "#d7e5e1";
        c.fillRect(mx(p.root.position.x) - 2, mz(p.root.position.z) - 2, 4, 4);
      }
    const o = OBJECTIVES[this.run.stage];
    c.save();
    c.translate(mx(o.x), mz(o.z));
    c.rotate(Math.PI / 4);
    c.strokeStyle = "#d2ff54";
    c.lineWidth = 2;
    c.strokeRect(-4, -4, 8, 8);
    c.restore();
    c.save();
    c.translate(mx(this.position.x), mz(this.position.z));
    c.rotate(-this.yaw);
    c.fillStyle = "#75e8ee";
    c.beginPath();
    c.moveTo(0, -7);
    c.lineTo(-5, 5);
    c.lineTo(0, 2);
    c.lineTo(5, 5);
    c.closePath();
    c.fill();
    c.restore();
    if (full) {
      c.font = "11px monospace";
      c.fillStyle = "#a3c3ce";
      c.fillText("N ↑", w - 40, 25);
      c.font = "10px monospace";
      for (const [name, x, z] of [
        ["ORISON / ECHO", 0, -70],
        ["STREET RELAY", -20, 2],
        ["MIDNIGHT RAMEN", 15, 33],
        ["EXTRACTION", 1, 73],
      ] as const) {
        c.fillStyle = "#c8dba8";
        c.fillText(name, mx(x) - 40, mz(z));
      }
    }
  }
  private toast(message: string, duration = 3) {
    text("toast", message);
    show("toast");
    this.toastTimer = duration;
  }
  private subtitle(speaker: string, line: string, duration = 5) {
    text("speaker", speaker);
    text("subtitle-text", line);
    show("subtitle-box");
    this.subtitleTimer = duration;
  }
  private end(dead: boolean) {
    this.hideOverlays();
    this.open("ending");
    text(
      "ending-code",
      dead ? "NEURAL LINK / LOST" : "CONTRACT COMPLETE / VOLUME 01",
    );
    text(
      "ending-title",
      dead
        ? "The signal went dark."
        : this.run.ending === "broadcast"
          ? "The city heard you."
          : "Silence has a price.",
    );
    text(
      "ending-copy",
      dead
        ? "East Ward takes more than it gives. Your last checkpoint is still there. Return to the title to continue, or start a new contract."
        : this.run.ending === "broadcast"
          ? "At 03:14, every screen in East Ward went white. Then the memories came home. Orison called it a service disruption. Iona called it a beginning. You disappeared into the rain."
          : "The money arrived before the rain stopped. By morning, Echo was gone, along with every trace of Iona's sister. The city kept moving. Your account was full. Your frequency stayed silent.",
    );
    text("stat-time", fmtTime(this.run.elapsed));
    text("stat-kills", this.run.kills);
    text("stat-credits", this.run.credits.toLocaleString());
    if (!dead) storage.set(SAVE, "");
    show("scanner-overlay", false);
  }
  private animate = (now: number) => {
    const raw = (now - this.last) / 1000;
    const dt = clamp(raw, 0.001, 0.25);
    this.last = now;
    this.clock += dt;
    this.fps = T.MathUtils.lerp(this.fps, 1 / Math.max(raw, 0.001), 0.05);
    this.flash = Math.max(0, this.flash - dt);
    this.shotCooldown = Math.max(0, this.shotCooldown - dt);
    this.hitMarker = Math.max(0, this.hitMarker - dt);
    this.hitFlash = Math.max(0, this.hitFlash - dt);
    this.city.muzzle.visible = this.flash > 0;
    el("hit-marker").style.opacity = String(this.hitMarker > 0 ? 1 : 0);
    el("damage-flash").style.opacity = String(this.hitFlash * 2);
    if (
      this.mode === "menu" ||
      (this.mode === "settings" && this.settingsReturn === "menu") ||
      (this.mode === "manual" && this.manualReturn === "menu")
    ) {
      this.camera.position.set(
        -1.3 + Math.sin(this.clock * 0.08) * 0.6,
        3.1,
        47,
      );
      this.camera.lookAt(2, 11, -35);
      this.camera.fov = 65;
      this.camera.updateProjectionMatrix();
    }
    if (this.mode === "playing") {
      this.run.elapsed += dt;
      this.updatePlayer(dt);
      this.updateEnemies(dt);
      this.hudTimer -= dt;
      if (this.hudTimer <= 0) {
        this.updateHUD();
        this.hudTimer = 0.1;
      }
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) show("toast", false);
      this.subtitleTimer -= dt;
      if (this.subtitleTimer <= 0) show("subtitle-box", false);
    }
    this.city.update(
      dt,
      this.run.elapsed,
      this.mode === "playing",
      this.settings.reducedMotion,
    );
    this.city.objective.position.set(
      OBJECTIVES[this.run.stage].x,
      0.04,
      OBJECTIVES[this.run.stage].z,
    );
    this.qualityTimer += dt;
    if (this.settings.quality === "low" && this.qualityTimer > 3) {
      this.qualityTimer = 0;
      const current = this.renderer.getPixelRatio();
      if (this.fps < 24 && current > 0.26) {
        const next = Math.max(0.25, current * 0.75);
        this.renderer.setPixelRatio(next);
        this.composer.setPixelRatio(next);
        this.resize();
      }
    }
    if (!document.hidden) {
      this.renderer.info.reset();
      if (this.settings.quality === "low")
        this.renderer.render(this.city.scene, this.camera);
      else this.composer.render();
    }
    requestAnimationFrame(this.animate);
  };
}

// Font loading is bounded: an offline font failure must never prevent boot.
Promise.race([
  document.fonts.load("700 20px Rajdhani"),
  new Promise((r) => setTimeout(r, 1800)),
]).then(() => {
  try {
    new Game();
  } catch (error) {
    show("boot", false);
    show("fatal");
    text(
      "fatal-message",
      `BLACKLINE could not initialize WebGL2. Enable hardware acceleration or use a current Chrome, Edge, Firefox, or Safari browser. ${error instanceof Error ? error.message : "Unknown graphics error"}`,
    );
    console.error(error);
  }
});
