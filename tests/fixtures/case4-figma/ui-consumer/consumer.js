import { IconButton, installFrontendUiTokens } from "@frontend/ui";
import { Circle, Close, Spot } from "@frontend/ui/icons/vue";

installFrontendUiTokens();

const copyResult = document.querySelector("#copy-result");
const copyButton = IconButton({
  ariaLabel: "비교 링크 복사",
  onPress: async () => {
    await navigator.clipboard.writeText(location.href);
    copyResult.textContent = "비교 링크를 복사했습니다";
  },
});
document.querySelector("#header-actions").replaceChildren(copyButton);

const icons = [
  Spot({ size: 16, color: "--semantic-text-tertiary", state: "normal" }),
  Circle({ size: 16, color: "--semantic-status-positive", state: "available" }),
  Close({ size: 16, color: "--semantic-status-negative", state: "unavailable" }),
];
document.querySelector("#icon-fixtures").replaceChildren(...icons);

window.__CASE4_UI_READY__ = Promise.resolve({
  modules: ["@frontend/ui", "@frontend/ui/icons/vue"],
});
