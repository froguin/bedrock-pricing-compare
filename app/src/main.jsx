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
// borderless containers. The dark column was measured from the live console
// (computed --color-* values with .awsui-one-theme.awsui-polaris-dark-mode).
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
      colorBackgroundLayoutMain: ld(N[100], "#100f0d"),
      colorBackgroundContainerContent: ld("#ffffff", "#161512"),
      colorBackgroundContainerHeader: ld("#ffffff", "#161512"),
      colorBackgroundInputDefault: ld("#ffffff", "#100f0d"),
      colorBackgroundDropdownItemDefault: ld("#ffffff", "#262420"),
      colorBackgroundDropdownItemHover: ld(N[200], "#1b1a17"),
      colorBackgroundDropdownItemSelected: ld(B[50], "#100f0d"),
      colorBackgroundCellShaded: ld(N[150], "#1b1a17"),
      colorBackgroundItemSelected: ld(B[50], "#100f0d"),
      colorBackgroundPopover: ld("#ffffff", "#262420"),
      colorBorderPopover: ld(N[350], "#6f6b63"),
      colorBorderDividerDefault: ld(N[300], "#2f2d28"),
      colorBorderDividerSecondary: ld(N[250], "#262420"),
      colorBorderContainerTop: ld("transparent", "transparent"),
      colorBorderInputDefault: ld(N[500], "#6f6b63"),
      colorBorderDropdownContainer: ld(N[400], "#6f6b63"),
      // text
      colorTextBodyDefault: ld(N[850], "#bab7b0"),
      colorTextBodySecondary: ld(N[600], "#aca9a2"),
      colorTextHeadingDefault: ld(N[950], "#eeedeb"),
      colorTextHeadingSecondary: ld(N[600], "#aca9a2"),
      colorTextFormLabel: ld(N[850], "#cbc9c3"),
      colorTextFormSecondary: ld(N[600], "#aca9a2"),
      colorTextLabel: ld(N[600], "#949088"),
      colorTextGroupLabel: ld(N[600], "#cbc9c3"),
      colorTextCounter: ld(N[600], "#aca9a2"),
      colorTextInputPlaceholder: ld(N[600], "#aca9a2"),
      colorTextStatusInactive: ld(N[600], "#aca9a2"),
      colorTextTopNavigationTitle: ld(N[950], "#f9f9f9"),
      // buttons: primary is near-black (inverted in dark), normal is neutral
      colorBackgroundButtonPrimaryDefault: ld(N[800], "#e3e1de"),
      colorBackgroundButtonPrimaryHover: ld(N[700], "#f3f3f1"),
      colorBackgroundButtonPrimaryActive: ld(N[700], "#f3f3f1"),
      colorBorderButtonPrimaryDefault: ld(N[800], "#e3e1de"),
      colorBorderButtonPrimaryHover: ld(N[700], "#f3f3f1"),
      colorTextButtonPrimaryDefault: ld(N[100], "#161512"),
      colorBackgroundButtonNormalDefault: ld(N[100], "#201e1b"),
      colorBackgroundButtonNormalHover: ld(N[150], "#262420"),
      colorBorderButtonNormalDefault: ld(N[500], "#6f6b63"),
      colorBorderButtonNormalHover: ld(N[600], "#949088"),
      colorTextButtonNormalDefault: ld(N[700], "#cbc9c3"),
      colorTextButtonNormalHover: ld(N[850], "#eeedeb"),
      // segmented control
      colorBackgroundSegmentWrapper: ld(N[100], "#161512"),
      colorBackgroundSegmentDefault: ld("transparent", "transparent"),
      colorBackgroundSegmentHover: ld("#ffffff", N[850]),
      colorBackgroundSegmentActive: ld(B[50], "#e3e1de"),
      colorTextSegmentActive: ld(N[900], "#161512"),
      colorTextSegmentDefault: ld(N[700], "#e3e1de"),
      // blue = accent/selection/focus only; links stay neutral, blue on hover
      colorTextAccent: ld(B[600], "#7598ff"),
      colorTextInteractiveActive: ld(B[600], "#f9f9f9"),
      colorTextLinkDefault: ld(N[850], "#cbc9c3"),
      colorTextLinkHover: ld(B[600], "#7598ff"),
      colorTextLinkInfoDefault: ld(N[850], "#cbc9c3"),
      colorBackgroundControlChecked: ld(B[600], "#5c7fff"),
      colorBorderItemFocused: ld(B[600], "#5c7fff"),
      colorBorderItemSelected: ld(B[600], "#5c7fff"),
      // status + soft badges (tinted fill, coloured text)
      colorTextStatusSuccess: ld("#00802f", "#aeffa8"),
      colorTextStatusInfo: ld(B[600], "#94afff"),
      colorTextStatusWarning: ld("#855900", "#fced69"),
      colorTextStatusError: ld("#db0000", "#ff7a7a"),
      colorBackgroundBadgeGrey: ld(N[250], "#3e3b35"),
      colorTextBadgeGrey: ld(N[850], "#e3e1de"),
      colorBackgroundBadgeBlue: ld(B[100], "rgba(92, 127, 255, .2)"),
      colorTextBadgeBlue: ld(B[600], "#94afff"),
      colorBackgroundBadgeGreen: ld("#d9f7de", "rgba(43, 181, 52, .2)"),
      colorTextBadgeGreen: ld("#00802f", "#aeffa8"),
      // type
      fontWeightHeadingXl: "500", fontWeightHeadingL: "500", fontWeightHeadingM: "500", fontWeightHeadingS: "500",
      letterSpacingHeadingXl: "-0.02em", letterSpacingHeadingL: "-0.015em", letterSpacingHeadingM: "-0.01em",
      fontWeightButton: "500",
      fontWeightFormLabel: "600",
      fontSizeHeadingXl: "24px", lineHeightHeadingXl: "30px",
      // Hangul needs more leading than the 20px AWS uses for Latin
      lineHeightBodyM: "22px",
      fontSizeBodyS: "13px",
      lineHeightBodyS: "18px",
      spaceFieldVertical: "4px",
      // shape
      // console cards measured at 4px radius, 1px hairline, no shadow
      borderRadiusContainer: "4px",
      borderRadiusInput: "4px",
      borderRadiusButton: "4px",
      borderRadiusDropdown: "4px",
      borderRadiusPopover: "4px",
      borderRadiusItem: "4px",
      borderRadiusBadge: "4px",
      borderRadiusAlert: "2px",
    },
    contexts: {
      // console top bar = page surface (#100f0d in dark), not Cloudscape's navy
      "top-navigation": { tokens: {
        colorBackgroundContainerContent: ld("#ffffff", "#100f0d"),
        colorTextTopNavigationTitle: ld(N[950], N[100]),
      } },
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
