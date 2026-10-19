import React from "react";
import { createRoot } from "react-dom/client";
// index-base.css = global styles WITHOUT the bundled Open Sans faces: we set
// Ember Modern / Amazon Ember + Pretendard, so inlining 8 unused font files would only add weight.
import "@cloudscape-design/global-styles/index-base.css";
import "./ember.css";
import "./app.css";
import { applyTheme } from "@cloudscape-design/components/theming";
import { applyDensity, Density } from "@cloudscape-design/global-styles";
import App from "./App.jsx";

// Compact density = the vanilla page's data-tool rhythm (Cloudscape's default
// "comfortable" is tuned for sparse console forms).
applyDensity(Density.Compact);

// 2026 AWS Console look ("one theme"). Values are read from the Cloudscape
// bundle aws.amazon.com itself ships (.awsui-one-theme, light mode): warm
// neutrals, near-black primary buttons, blue only for selection/focus/accent,
// 2px containers / 4px controls, weight-500 headings with tight tracking,
// borderless containers. aws.amazon.com ships light only, so the dark column is
// derived from the same neutral/primary scales.
const N = { 50:"#fcfcfc",100:"#f9f9f9",150:"#f8f8f7",200:"#f3f3f1",250:"#eeedeb",300:"#e3e1de",
  350:"#cbc9c3",400:"#bab7b0",450:"#aca9a2",500:"#949088",550:"#868279",600:"#6f6b63",650:"#4c4942",
  700:"#3e3b35",750:"#2f2d28",800:"#262420",850:"#201e1b",900:"#1b1a17",950:"#161512",1000:"#100f0d" };
const B = { 50:"#f5f7ff",100:"#dbe4ff",200:"#c2d1ff",300:"#94afff",400:"#7598ff",500:"#5c7fff",
  600:"#295eff",700:"#003efa",800:"#0033cc",900:"#001a99",1000:"#000833" };
const ld = (light, dark) => ({ light, dark });

applyTheme({
  theme: {
    tokens: {
      // Ember Modern is used when the visitor has it (AWS ships it only inside
      // its own CDN, not as a redistributable file); otherwise the embedded
      // Amazon Ember, then Pretendard for Hangul.
      fontFamilyBase: '"Ember Modern Text UI", "Amazon Ember Modern", "Ember Modern Text", "Amazon Ember", "Pretendard", -apple-system, system-ui, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif',
      // surfaces
      colorBackgroundLayoutMain: ld(N[100], N[1000]),
      colorBackgroundContainerContent: ld("#ffffff", N[950]),
      colorBackgroundContainerHeader: ld("#ffffff", N[950]),
      colorBackgroundInputDefault: ld("#ffffff", N[950]),
      colorBackgroundDropdownItemDefault: ld("#ffffff", N[950]),
      colorBackgroundDropdownItemHover: ld(N[200], N[850]),
      colorBackgroundDropdownItemSelected: ld(B[50], "#0b1433"),
      colorBackgroundCellShaded: ld(N[150], N[900]),
      colorBackgroundItemSelected: ld(B[50], "#0b1433"),
      colorBackgroundPopover: ld("#ffffff", N[900]),
      colorBorderPopover: ld(N[350], N[700]),
      colorBorderDividerDefault: ld(N[300], N[750]),
      colorBorderDividerSecondary: ld(N[250], N[800]),
      colorBorderContainerTop: ld("transparent", "transparent"),
      colorBorderInputDefault: ld(N[500], N[600]),
      colorBorderDropdownContainer: ld(N[400], N[650]),
      // text
      colorTextBodyDefault: ld(N[850], N[200]),
      colorTextBodySecondary: ld(N[600], N[450]),
      colorTextHeadingDefault: ld(N[950], N[100]),
      colorTextHeadingSecondary: ld(N[600], N[450]),
      colorTextFormLabel: ld(N[850], N[200]),
      colorTextFormSecondary: ld(N[600], N[450]),
      colorTextLabel: ld(N[600], N[450]),
      colorTextGroupLabel: ld(N[600], N[450]),
      colorTextCounter: ld(N[600], N[450]),
      colorTextInputPlaceholder: ld(N[600], N[550]),
      colorTextStatusInactive: ld(N[600], N[500]),
      colorTextTopNavigationTitle: ld(N[950], N[100]),
      // buttons: primary is near-black (inverted in dark), normal is neutral
      colorBackgroundButtonPrimaryDefault: ld(N[800], N[300]),
      colorBackgroundButtonPrimaryHover: ld(N[700], N[100]),
      colorBackgroundButtonPrimaryActive: ld(N[700], N[100]),
      colorBorderButtonPrimaryDefault: ld(N[800], N[300]),
      colorBorderButtonPrimaryHover: ld(N[700], N[100]),
      colorTextButtonPrimaryDefault: ld(N[100], N[950]),
      colorBackgroundButtonNormalDefault: ld(N[100], N[950]),
      colorBackgroundButtonNormalHover: ld(N[150], N[850]),
      colorBorderButtonNormalDefault: ld(N[500], N[600]),
      colorBorderButtonNormalHover: ld(N[600], N[450]),
      colorTextButtonNormalDefault: ld(N[700], N[250]),
      colorTextButtonNormalHover: ld(N[850], N[100]),
      // segmented control
      colorBackgroundSegmentWrapper: ld(N[100], N[900]),
      colorBackgroundSegmentDefault: ld("transparent", "transparent"),
      colorBackgroundSegmentHover: ld("#ffffff", N[850]),
      colorBackgroundSegmentActive: ld(B[50], "#0b1433"),
      colorTextSegmentActive: ld(N[900], N[100]),
      colorTextSegmentDefault: ld(N[700], N[350]),
      // blue = accent/selection/focus only; links stay neutral, blue on hover
      colorTextAccent: ld(B[600], B[400]),
      colorTextInteractiveActive: ld(B[600], B[400]),
      colorTextLinkDefault: ld(N[850], N[200]),
      colorTextLinkHover: ld(B[600], B[400]),
      colorTextLinkInfoDefault: ld(N[850], N[200]),
      colorBackgroundControlChecked: ld(B[600], B[400]),
      colorBorderItemFocused: ld(B[600], B[400]),
      colorBorderItemSelected: ld(B[600], B[400]),
      // status + soft badges (tinted fill, coloured text)
      colorTextStatusSuccess: ld("#00802f", "#4fd16a"),
      colorTextStatusInfo: ld(B[600], B[400]),
      colorTextStatusWarning: ld("#855900", "#f0b43c"),
      colorTextStatusError: ld("#db0000", "#ff7a7a"),
      colorBackgroundBadgeGrey: ld(N[250], N[800]),
      colorTextBadgeGrey: ld(N[850], N[200]),
      colorBackgroundBadgeBlue: ld(B[100], "#0f1d4d"),
      colorTextBadgeBlue: ld(B[600], B[300]),
      colorBackgroundBadgeGreen: ld("#d9f7de", "#0b2a12"),
      colorTextBadgeGreen: ld("#00802f", "#4fd16a"),
      // type
      fontWeightHeadingXl: "500", fontWeightHeadingL: "500", fontWeightHeadingM: "500", fontWeightHeadingS: "500",
      letterSpacingHeadingXl: "-0.02em", letterSpacingHeadingL: "-0.015em", letterSpacingHeadingM: "-0.01em",
      fontWeightButton: "500",
      fontWeightFormLabel: "600",
      fontSizeHeadingXl: "24px", lineHeightHeadingXl: "30px",
      // Hangul needs more leading than the 20px AWS uses for Latin
      lineHeightBodyM: "22px",
      fontSizeBodyS: "13px",
      lineHeightBodyS: "19px",
      spaceFieldVertical: "4px",
      // shape
      borderRadiusContainer: "2px",
      borderRadiusInput: "4px",
      borderRadiusButton: "4px",
      borderRadiusDropdown: "4px",
      borderRadiusPopover: "4px",
      borderRadiusItem: "4px",
      borderRadiusBadge: "4px",
      borderRadiusAlert: "2px",
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
