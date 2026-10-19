import React from "react";
import { createRoot } from "react-dom/client";
// index-base.css = global styles WITHOUT the bundled Open Sans faces: we set
// Amazon Ember + Pretendard, so inlining 8 unused font files would only add weight.
import "@cloudscape-design/global-styles/index-base.css";
import "./ember.css";
import { applyTheme } from "@cloudscape-design/components/theming";
import App from "./App.jsx";

// awskr.net house accent (purple) + Amazon Ember. Green/blue stay as Cloudscape
// status colours, so purple is used only for brand/interaction tokens.
const P = { light: "#9333ea", dark: "#a855f7" };
const PH = { light: "#7e22ce", dark: "#b974f9" };
applyTheme({
  theme: {
    tokens: {
      fontFamilyBase: '"Amazon Ember", "Pretendard", -apple-system, system-ui, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif',
      colorBackgroundButtonPrimaryDefault: P,
      colorBackgroundButtonPrimaryHover: PH,
      colorBackgroundButtonPrimaryActive: PH,
      colorBorderButtonPrimaryDefault: P,
      colorBorderButtonPrimaryHover: PH,
      colorBorderButtonNormalDefault: P,
      colorBorderButtonNormalHover: PH,
      colorTextButtonNormalDefault: P,
      colorTextButtonNormalHover: PH,
      colorTextLinkDefault: P,
      colorTextLinkHover: PH,
      colorTextAccent: P,
      colorTextInteractiveActive: P,
      colorBackgroundControlChecked: P,
      colorBackgroundSegmentActive: P,
      colorBorderItemFocused: P,
      colorBorderItemSelected: P,
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
