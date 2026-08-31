import type { Config } from "tailwindcss";

/**
 * Design tokens mirrored 1:1 from the Figma file
 * (https://www.figma.com/design/yT3XNK1Vro1ndhMRW2X3gr).
 *
 * Keep these two in sync by hand: Tailwind has no live Figma connection here,
 * so a token renamed in Figma needs the same rename made in this file.
 */
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-inter)", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      colors: {
        surface: {
          page: "#F7F7F5",
          card: "#FFFFFF",
          sunken: "#EFEFEC",
          inverse: "#1C1C1A",
        },
        ink: {
          primary: "#1C1C1A",
          secondary: "#5C5C56",
          muted: "#8A8A82",
          inverse: "#FFFFFF",
        },
        border: {
          subtle: "#E2E2DD",
          strong: "#C7C7C0",
        },
        correct: { bg: "#EAF5EC", border: "#5C9E6B", text: "#2F6B3D" },
        wrong: { bg: "#FBEDEC", border: "#C0665E", text: "#8F3A32" },
        // Deeper amber than the original #C79A4A — that border read as pale on
        // white in the 24px palette dots (user feedback: "màu vàng nhạt...
        // hơi chìm trên nền trắng").
        flagged: { bg: "#FBEBC7", border: "#B8842E", text: "#6F4A0F" },
        accent: { solid: "#3A5A78", soft: "#E7EDF3", text: "#2C4459" },
        // Keyed by the certification's `accent` field (src/lib/domain.ts ACCENTS),
        // not by certification code — a new certification just picks one of
        // these five, no new token needed.
        certAccent: {
          indigo: { solid: "#3A5A78", soft: "#E7EDF3", text: "#2C4459" },
          teal: { solid: "#2F6E68", soft: "#E4EFED", text: "#245650" },
          amber: { solid: "#9A6B24", soft: "#F6EEE1", text: "#7A5419" },
          plum: { solid: "#7A4B73", soft: "#F1E7EF", text: "#5E3A58" },
          slate: { solid: "#55606B", soft: "#E9ECEE", text: "#414A53" },
        },
        mode: {
          mock: { bg: "#E7EDF3", border: "#8FA8BF", text: "#3A5A78" },
          domain: { bg: "#EEEAF5", border: "#A294C4", text: "#5C4B85" },
          quick: { bg: "#E4EFEA", border: "#89B5A2", text: "#34705A" },
          review: { bg: "#F7EAE8", border: "#CE9A94", text: "#9A554C" },
        },
        ground: { top: "#E7ECF4", bottom: "#FBFBFA" },
      },
      fontSize: {
        "display-score": ["56px", { lineHeight: "1.1", letterSpacing: "-0.02em", fontWeight: "700" }],
        "heading-xl": ["32px", { lineHeight: "1.25", letterSpacing: "-0.01em", fontWeight: "600" }],
        "heading-l": ["24px", { lineHeight: "1.3", letterSpacing: "-0.005em", fontWeight: "600" }],
        "heading-m": ["18px", { lineHeight: "1.4", fontWeight: "600" }],
        "heading-s": ["15px", { lineHeight: "1.4", fontWeight: "600" }],
        "body-default": ["16px", { lineHeight: "1.6", fontWeight: "400" }],
        "body-medium": ["16px", { lineHeight: "1.6", fontWeight: "500" }],
        "body-small": ["14px", { lineHeight: "1.55", fontWeight: "400" }],
        caption: ["13px", { lineHeight: "1.45", fontWeight: "400" }],
        label: ["13px", { lineHeight: "1.4", letterSpacing: "0.02em", fontWeight: "500" }],
        "mono-label": ["12px", { lineHeight: "1.4", letterSpacing: "0.04em", fontWeight: "600" }],
      },
      backgroundImage: {
        ground: "linear-gradient(180deg, #E7ECF4 0%, #FBFBFA 50%, #FBFBFA 100%)",
      },
      maxWidth: {
        prose: "760px",
      },
    },
  },
  plugins: [],
};

export default config;
