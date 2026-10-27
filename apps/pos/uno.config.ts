import { defineConfig, presetUno, transformerDirectives } from "unocss";
import presetAnimations from "unocss-preset-animations";

// Warm-stone surfaces, near-monochrome chrome. Colour is reserved for money and actions.
// Hit areas are sized for a touchscreen till at 1.0x zoom.
export default defineConfig({
  presets: [presetUno(), presetAnimations()],
  transformers: [transformerDirectives()],
  preflights: [
    {
      getCSS: () =>
        "*,::before,::after{border-width:0;border-style:solid;border-color:#e2e4e8}",
    },
  ],
  theme: {
    colors: {
      cream: "#f7f6f2",
      ground: "#f7f6f2",
      surface: "#ffffff",
      panel: "#f3f4f6",
      raised: "#f3f4f6",
      active: "#e5e7eb",
      tile: "#ffffff",
      line: "#f7f6f2",
      ink: "#131416",
      muted: "#52555a",
      faint: "#686b70",
      border: "#e2e4e8",
      borderSoft: "#eef0f2",
      control: "#c8ccd0",
      olive: "#131416",
      oliveDark: "#131416",
      terracotta: "#131416",
      positive: "#1e7b4f",
      negative: "#c4242a",
      warning: "#92400e",
      date: "#131416",
      chart: "#131416",
      warm: "#f3f4f6",
      warmBorder: "#e2e4e8",
    },
    fontFamily: {
      display: "'Nunito Variable', system-ui, -apple-system, sans-serif",
      sans: "'Nunito Variable', system-ui, -apple-system, sans-serif",
    },
  },
  shortcuts: {
    press: "transition-transform duration-75 active:scale-[0.99]",
    "btn-pay":
      "border-none rounded-6px bg-positive text-white font-sans font-700 cursor-pointer press disabled:opacity-45 disabled:cursor-default disabled:active:scale-100",
    "btn-primary":
      "border border-ink rounded-6px bg-ink text-white font-sans font-700 cursor-pointer press disabled:opacity-45 disabled:cursor-default disabled:active:scale-100",
    "btn-ghost":
      "rounded-6px border border-border bg-surface font-700 text-ink cursor-pointer press",
    "sr-only":
      "absolute w-1px h-1px p-0 -m-1px overflow-hidden whitespace-nowrap border-0",
    "card-tile":
      "bg-surface border border-border rounded-8px cursor-pointer press hover:border-control",
    "tile-dark":
      "rounded-6px border border-border bg-surface font-700 text-ink cursor-pointer press",
    "tile-warm":
      "rounded-6px border border-border bg-panel font-700 text-ink cursor-pointer press",
    "adj-btn":
      "flex-none rounded-6px border border-border bg-panel font-700 text-ink cursor-pointer press",
    "pill-btn":
      "rounded-6px border border-border bg-surface font-700 text-ink cursor-pointer press",
  },
});
