import React from "react";
import { createRoot } from "react-dom/client";
// index-base.css = global styles WITHOUT the bundled Open Sans faces: we set
// Amazon Ember + Pretendard, so inlining 8 unused font files would only add weight.
import "@cloudscape-design/global-styles/index-base.css";
import "./ember.css";
import "./app.css";
import { applyTheme } from "@cloudscape-design/components/theming";
import App from "./App.jsx";

// awskr.net house accent (purple) + Amazon Ember. Green/blue stay as Cloudscape
// status colours, so purple is used only for brand/interaction tokens.
// awskr.net house palette — the SAME values as web/index.html's :root tokens
// (dark) and :root[data-theme=light] (light), mapped onto Cloudscape tokens so
// both pages share one colour system. Purple = brand/interaction only;
// green/blue/amber stay status colours.
const V = {
  bg:        { light: "#f6f7fb", dark: "#0d0f17" },
  surface1:  { light: "#ffffff", dark: "#141825" },
  surface2:  { light: "#f0f2f8", dark: "#1b2030" },
  surface3:  { light: "#e7eaf3", dark: "#232a3d" },
  line:      { light: "#d9deea", dark: "#2a3146" },
  lineSoft:  { light: "#e8ebf3", dark: "#1f2535" },
  txt:       { light: "#1a1f2e", dark: "#e9ecf5" },
  ink:       { light: "#39415a", dark: "#c3cadb" },
  muted:     { light: "#5f6880", dark: "#8a92a8" },
  faint:     { light: "#8a93aa", dark: "#5b6378" },
  accent:    { light: "#9333ea", dark: "#a855f7" },
  accentHov: { light: "#7e22ce", dark: "#b974f9" },
  accentSoft:{ light: "#f3e8ff", dark: "#2a1d44" },
  onAccent:  { light: "#ffffff", dark: "#0c0714" },
  ok:        { light: "#15935c", dark: "#46c988" },
  okSoft:    { light: "#dcf5e8", dark: "#10281c" },
  info:      { light: "#2563eb", dark: "#5ea0ef" },
  infoSoft:  { light: "#dbe8ff", dark: "#111f33" },
  warn:      { light: "#a97b12", dark: "#e0b03a" },
  warnSoft:  { light: "#fbf0d2", dark: "#2a2110" },
};
applyTheme({
  theme: {
    tokens: {
      fontFamilyBase: '"Amazon Ember", "Pretendard", -apple-system, system-ui, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif',
      // surfaces
      colorBackgroundLayoutMain: V.bg,
      colorBackgroundContainerContent: V.surface1,
      colorBackgroundContainerHeader: V.surface1,
      colorBackgroundInputDefault: V.surface2,
      colorBackgroundDropdownItemDefault: V.surface1,
      colorBackgroundDropdownItemHover: V.surface3,
      colorBackgroundCellShaded: V.surface2,
      colorBackgroundButtonNormalDefault: V.surface1,
      colorBackgroundButtonNormalHover: V.accentSoft,
      colorBackgroundSegmentDefault: V.surface2,
      colorBackgroundSegmentHover: V.surface3,
      colorBackgroundItemSelected: V.accentSoft,
      colorBorderDividerDefault: V.line,
      colorBorderDividerSecondary: V.lineSoft,
      colorBorderInputDefault: V.line,
      colorBorderContainerTop: V.line,
      // text
      colorTextBodyDefault: V.ink,
      colorTextHeadingDefault: V.txt,
      colorTextHeadingSecondary: V.muted,
      colorTextBodySecondary: V.muted,
      colorTextFormLabel: V.txt,
      colorTextFormSecondary: V.muted,
      colorTextGroupLabel: V.muted,
      colorTextCounter: V.muted,
      colorTextInputPlaceholder: V.faint,
      colorTextStatusInactive: V.faint,
      // accent (interaction)
      colorBackgroundButtonPrimaryDefault: V.accent,
      colorBackgroundButtonPrimaryHover: V.accentHov,
      colorBackgroundButtonPrimaryActive: V.accentHov,
      colorBorderButtonPrimaryDefault: V.accent,
      colorBorderButtonPrimaryHover: V.accentHov,
      colorBorderButtonNormalDefault: V.line,
      colorBorderButtonNormalHover: V.accent,
      colorTextButtonNormalDefault: V.ink,
      colorTextButtonNormalHover: V.accent,
      colorTextLinkDefault: V.accent,
      colorTextLinkHover: V.accentHov,
      colorTextAccent: V.accent,
      colorTextInteractiveActive: V.accent,
      colorBackgroundControlChecked: V.accent,
      colorBackgroundSegmentActive: V.accent,
      colorBorderItemFocused: V.accent,
      colorBorderItemSelected: V.accent,
      // status (never the accent)
      colorTextStatusSuccess: V.ok,
      colorTextStatusInfo: V.info,
      colorTextStatusWarning: V.warn,
      colorBackgroundStatusSuccess: V.okSoft,
      colorBackgroundStatusInfo: V.infoSoft,
      colorBackgroundStatusWarning: V.warnSoft,
      colorBackgroundBadgeGrey: V.surface3,
      colorBackgroundBadgeBlue: V.info,
      colorBackgroundBadgeGreen: V.ok,
      // shape — vanilla radii (r-md 10, r-lg 14, pill buttons/badges)
      borderRadiusContainer: "14px",
      borderRadiusInput: "10px",
      borderRadiusDropdown: "10px",
      borderRadiusPopover: "10px",
      borderRadiusButton: "999px",
      borderRadiusBadge: "999px",
      borderRadiusAlert: "10px",
      borderRadiusItem: "8px",
    },
  },
});

async function loadSnapshot() {
  if (window.__PRICING__) return window.__PRICING__;          // standalone build
  const res = await fetch("./pricing.json", { cache: "no-cache" }); // vite dev
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  return res.json();
}

const root = createRoot(document.getElementById("root"));
loadSnapshot()
  .then((snap) => {
    if (!snap || !Array.isArray(snap.price_points) || !snap.price_points.length)
      throw new Error("pricing.json에 price_points가 없습니다");
    root.render(<App snap={snap} />);
  })
  .catch((err) => {
    root.render(<p style={{ padding: 24 }}>데이터를 불러오지 못했습니다 — {String(err.message || err)}</p>);
  });
