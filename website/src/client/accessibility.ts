const SKIP_TARGET_ID = "__docusaurus_skipToContent_fallback";

function activateSkipTarget(): void {
  const target = document.getElementById(SKIP_TARGET_ID);
  if (target === null) return;
  if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
  const hash = `#${SKIP_TARGET_ID}`;
  if (window.location.hash !== hash) {
    window.history.replaceState(
      window.history.state,
      "",
      `${window.location.pathname}${window.location.search}${hash}`,
    );
  }
  target.focus({ preventScroll: false });
  target.scrollIntoView({ block: "start" });
}

function handleSkipLink(event: MouseEvent): void {
  if (!(event.target instanceof Element)) return;
  if (event.target.closest(".navbar-sidebar__close") !== null) {
    const toggle = document.querySelector<HTMLButtonElement>(".navbar__toggle");
    if (toggle !== null) {
      window.setTimeout(() => toggle.focus({ preventScroll: true }), 0);
    }
    return;
  }
  const link = event.target.closest<HTMLAnchorElement>(`a[href="#${SKIP_TARGET_ID}"]`);
  if (link === null) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  activateSkipTarget();
}

if (typeof document !== "undefined") {
  document.addEventListener("click", handleSkipLink, true);
}
