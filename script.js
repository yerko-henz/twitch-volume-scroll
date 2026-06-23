(function () {
  "use strict";

  // ---------------------------------------------------------------------------
  // 0. Shared constants
  // ---------------------------------------------------------------------------
  const MSG_NS = "twitch-vol-scroll";
  const MSG_WHEEL = `${MSG_NS}:wheel`;
  const MSG_REGISTER = `${MSG_NS}:register`;
  const MSG_HELLO = `${MSG_NS}:hello`;

  const PLAYER_SELECTORS = [
    ".video-player__container",
    '[class*="video-player"]',
    ".persistent-player",
    ".channel-root__player",
    ".player-overlay",
    ".video-player",
    "[data-a-player-state]",
  ];

  const EXCLUDED_REGIONS = [
    ".chat-shell",
    ".chat-room",
    ".chat-list",
    ".side-nav",
    ".moderation-view-panel",
    ".channel-root__right-column",
    ".stream-chat",
    '[role="navigation"]',
  ].join(", ");

  const HIT_TOLERANCE = 4;
  const WHEEL_STEP_PIXEL = 0.01;
  const WHEEL_STEP_LINE = 0.05;

  // ---------------------------------------------------------------------------
  // 1. Visual indicator (top frame only)
  // ---------------------------------------------------------------------------
  let indicator;
  let hideTimeout;

  function initIndicator() {
    indicator = document.getElementById("scroll-vol-indicator");
    if (!indicator) {
      indicator = document.createElement("div");
      indicator.id = "scroll-vol-indicator";
      Object.assign(indicator.style, {
        position: "fixed",
        top: "20px",
        left: "20px",
        color: "rgba(255, 255, 255, 0.9)",
        fontSize: "20px",
        fontWeight: "bold",
        zIndex: "2147483647",
        pointerEvents: "none",
        display: "none",
        fontFamily: "sans-serif",
        textShadow: "1px 1px 2px black",
        padding: "4px 8px",
        borderRadius: "4px",
        background: "rgba(0, 0, 0, 0.35)",
      });
      document.body.appendChild(indicator);
    }
  }

  function showIndicator(video) {
    const rect = video.getBoundingClientRect();
    indicator.style.left = `${rect.left + 20}px`;
    indicator.style.top = `${rect.top + 20}px`;
    indicator.innerText = `${Math.round(video.volume * 100)}%`;
    indicator.style.display = "block";

    clearTimeout(hideTimeout);
    hideTimeout = setTimeout(() => {
      indicator.style.display = "none";
    }, 1500);
  }

  // ---------------------------------------------------------------------------
  // 2. Player discovery
  // ---------------------------------------------------------------------------

  /**
   * Returns the "main" video element.
   * On Twitch there can be many <video> tags (previews, ads, clips).
   * We choose the largest visible one.
   */
  function getMainVideo() {
    const candidates = Array.from(document.querySelectorAll("video")).filter(
      (v) => !v.paused || v.readyState > 0 || v.offsetParent !== null,
    );
    if (candidates.length === 0) return null;
    if (candidates.length === 1) return candidates[0];

    let best = null;
    let bestArea = 0;
    for (const v of candidates) {
      const rect = v.getBoundingClientRect();
      const area = rect.width * rect.height;
      if (area > bestArea && rect.width > 50 && rect.height > 50) {
        best = v;
        bestArea = area;
      }
    }
    return best || candidates[0];
  }

  /**
   * Try several known selectors, from newest/most specific to older fallbacks.
   * If none match, return the video's immediate offsetParent.
   */
  function getPlayerContainer(video) {
    if (!video) return null;

    for (const selector of PLAYER_SELECTORS) {
      const c = video.closest(selector);
      if (c) return c;
    }

    return video.parentElement;
  }

  /**
   * Return true if the point (x, y) is visually over the video player.
   *
   * The player container can grow/shrink as Twitch injects ads, extension
   * overlays and resize detectors, so we never use the container rect.
   * The authoritative region is the <video> element's own box, with a small
   * tolerance. We only reject if an excluded region (chat, sidebar, etc.) is
   * visually on top of the video.
   */
  function isOverPlayer(x, y, video) {
    if (!video) return false;

    const vRect = video.getBoundingClientRect();
    const insideVideo =
      x >= vRect.left - HIT_TOLERANCE &&
      x <= vRect.right + HIT_TOLERANCE &&
      y >= vRect.top - HIT_TOLERANCE &&
      y <= vRect.bottom + HIT_TOLERANCE;

    if (!insideVideo) return false;

    const topEl = document.elementFromPoint(x, y);
    if (topEl && topEl.closest(EXCLUDED_REGIONS)) return false;

    return true;
  }

  /**
   * Find the volume slider for a given player container.
   */
  function findVolumeSlider(container) {
    if (container) {
      const slider = container.querySelector(
        'input[type="range"], .range-input, [role="slider"]',
      );
      if (slider) return slider;
    }

    // Global fallback: aria-label / title containing "volume"
    return document.querySelector(
      'input[type="range"][aria-label*="volume" i], input[type="range"][title*="volume" i]',
    );
  }

  // ---------------------------------------------------------------------------
  // 3. Volume change logic (shared by top frame and forwarded iframe events)
  // ---------------------------------------------------------------------------

  function setVolume(video, newVol, container) {
    newVol = Math.min(1, Math.max(0, newVol));
    video.volume = parseFloat(newVol.toFixed(2));

    // Sync UI slider
    const slider = findVolumeSlider(container);
    if (slider) {
      const max = Number(
        slider.max || slider.getAttribute("aria-valuemax") || 1,
      );
      const isPercentScale = max > 1.1;
      slider.value = isPercentScale ? newVol * 100 : newVol;
      slider.dispatchEvent(new Event("input", { bubbles: true }));
      slider.dispatchEvent(new Event("change", { bubbles: true }));
    }

    // Sync React props if exposed
    if (container) {
      const reactKey = Object.keys(container).find(
        (k) =>
          k.startsWith("__reactProps") ||
          k.startsWith("__reactInternalInstance"),
      );
      if (reactKey) {
        const props =
          container[reactKey]?.children?.props ||
          container[reactKey]?.memoizedProps;
        if (props && typeof props.onVolumeChange === "function") {
          props.onVolumeChange(newVol);
        }
      }
    }

    video.dispatchEvent(new Event("volumechange", { bubbles: true }));
  }

  /**
   * Apply a wheel delta to the current volume. Returns true if a change was made.
   */
  function applyWheel(video, container, deltaY, deltaMode) {
    const step =
      deltaMode === WheelEvent.DOM_DELTA_PIXEL ? WHEEL_STEP_PIXEL : WHEEL_STEP_LINE;
    const direction = deltaY > 0 ? -step : step;
    const newVol = Math.min(1, Math.max(0, video.volume + direction));
    setVolume(video, newVol, container);
    return true;
  }

  // ---------------------------------------------------------------------------
  // 4. Top-frame mode
  // ---------------------------------------------------------------------------

  function runTopFrameMode() {
    initIndicator();

    /**
     * Core wheel handler. Called both for native window events and for wheel
     * events forwarded from registered overlay iframes.
     */
    function handleWheel(x, y, deltaY, deltaMode, sourceEvent) {
      const video = getMainVideo();
      if (!video) return false;
      if (!isOverPlayer(x, y, video)) return false;

      if (sourceEvent) {
        sourceEvent.preventDefault();
        sourceEvent.stopImmediatePropagation();
      }

      const container = getPlayerContainer(video);
      applyWheel(video, container, deltaY, deltaMode);
      showIndicator(video);
      return true;
    }

    // Native wheel events over non-iframe parts of the player.
    window.addEventListener(
      "wheel",
      (e) => {
        handleWheel(e.clientX, e.clientY, e.deltaY, e.deltaMode, e);
      },
      { passive: false, capture: true },
    );

    // Wheel events forwarded by overlay iframes that sit on top of the player.
    window.addEventListener("message", (e) => {
      if (!e.data || typeof e.data !== "object") return;

      if (e.data.type === MSG_WHEEL) {
        const sourceIframe = findIframeByWindow(e.source);
        if (!sourceIframe) return;

        const video = getMainVideo();
        if (!video) return;
        const container = getPlayerContainer(video);
        if (!container || !container.contains(sourceIframe)) return;

        const rect = sourceIframe.getBoundingClientRect();
        const x = rect.left + e.data.clientX;
        const y = rect.top + e.data.clientY;

        handleWheel(x, y, e.data.deltaY, e.data.deltaMode, null);
      } else if (e.data.type === MSG_HELLO) {
        const sourceIframe = findIframeByWindow(e.source);
        if (!sourceIframe) return;

        const video = getMainVideo();
        const container = video ? getPlayerContainer(video) : null;
        if (container && container.contains(sourceIframe)) {
          sourceIframe.contentWindow.postMessage({ type: MSG_REGISTER }, "*");
        }
      }
    });

    /**
     * Register any overlay iframes already inside the player container, and
     * watch for new ones. Only iframes inside the player get registered so we
     * don't steal scrolling from unrelated iframes (chat, extension popups, etc.).
     */
    function registerPlayerIframes() {
      const video = getMainVideo();
      const container = video ? getPlayerContainer(video) : null;
      if (!container) return;

      const iframes = container.querySelectorAll("iframe");
      for (const iframe of iframes) {
        if (iframe.contentWindow) {
          iframe.contentWindow.postMessage({ type: MSG_REGISTER }, "*");
        }
      }
    }

    registerPlayerIframes();

    const observer = new MutationObserver((mutations) => {
      const video = getMainVideo();
      const container = video ? getPlayerContainer(video) : null;
      if (!container) return;

      let shouldScan = false;
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue;
          if (
            node.tagName === "IFRAME" ||
            (node.querySelector && node.querySelector("iframe"))
          ) {
            if (container.contains(node)) {
              shouldScan = true;
            }
          }
        }
      }
      if (shouldScan) registerPlayerIframes();
    });

    observer.observe(document.body, { childList: true, subtree: true });
  }

  // ---------------------------------------------------------------------------
  // 5. Iframe mode
  // ---------------------------------------------------------------------------

  function runIframeMode() {
    let registered = false;

    function forwardWheel(e) {
      if (!registered) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      window.parent.postMessage(
        {
          type: MSG_WHEEL,
          deltaY: e.deltaY,
          deltaMode: e.deltaMode,
          clientX: e.clientX,
          clientY: e.clientY,
        },
        "*",
      );
    }

    window.addEventListener(
      "wheel",
      forwardWheel,
      { passive: false, capture: true },
    );

    window.addEventListener("message", (e) => {
      if (e.data && e.data.type === MSG_REGISTER) {
        registered = true;
      }
    });

    // Say hello a few times in case the parent script loads after this iframe.
    let attempts = 0;
    const helloInterval = setInterval(() => {
      window.parent.postMessage({ type: MSG_HELLO }, "*");
      attempts++;
      if (attempts >= 10) clearInterval(helloInterval);
    }, 500);
  }

  // ---------------------------------------------------------------------------
  // 6. Helpers
  // ---------------------------------------------------------------------------

  function findIframeByWindow(win) {
    const iframes = document.querySelectorAll("iframe");
    for (const iframe of iframes) {
      if (iframe.contentWindow === win) return iframe;
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // 7. Route
  // ---------------------------------------------------------------------------
  if (window.self === window.top) {
    runTopFrameMode();
  } else {
    runIframeMode();
  }
})();
