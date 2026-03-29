(function () {
  // 1. Create the Indicator Element once
  let indicator = document.getElementById("scroll-vol-indicator");
  if (!indicator) {
    indicator = document.createElement("div");
    indicator.id = "scroll-vol-indicator";
    // Applying your requested styles
    Object.assign(indicator.style, {
      position: "absolute",
      top: "10px",
      left: "10px",
      color: "rgba(255, 255, 255, 0.8)", // Light white
      fontSize: "20px",
      fontWeight: "bold",
      zIndex: "99999",
      pointerEvents: "none",
      display: "none",
      fontFamily: "sans-serif",
      textShadow: "1px 1px 2px black", // Ensures readability on light backgrounds
    });
    document.body.appendChild(indicator);
  }

  let hideTimeout;

  window.addEventListener(
    "wheel",
    (e) => {
      const video = document.querySelector("video");
      const container =
        video?.closest(".video-player__container") || video?.parentElement;
      if (!container || !video) return;

      // Hover check to ensure we only act when over the video
      const topElement = document.elementFromPoint(e.clientX, e.clientY);
      if (
        !topElement?.closest(".video-player__container") &&
        !topElement?.querySelector("video")
      )
        return;

      e.preventDefault();
      e.stopImmediatePropagation();

      const direction = e.deltaY > 0 ? -0.01 : 0.01;
      const newVol = Math.min(1, Math.max(0, video.volume + direction));
      video.volume = parseFloat(newVol.toFixed(2));

      // Sync UI Slider
      const slider = container.querySelector(
        'input[type="range"], .range-input, [role="slider"]',
      );
      if (slider) {
        const isPercentScale = slider.max > 1.1;
        slider.value = isPercentScale ? newVol * 100 : newVol;
        slider.dispatchEvent(new Event("input", { bubbles: true }));
        slider.dispatchEvent(new Event("change", { bubbles: true }));
      }

      // React Props Sync
      const reactKey = Object.keys(container).find((k) =>
        k.startsWith("__reactProps"),
      );
      if (reactKey && container[reactKey]?.children?.props) {
        const playerProps = container[reactKey].children.props;
        if (typeof playerProps.onVolumeChange === "function") {
          playerProps.onVolumeChange(newVol);
        }
      }

      video.dispatchEvent(new Event("volumechange", { bubbles: true }));

      // --- Visual Indicator Logic ---
      // Move indicator inside the relative container if not already there
      if (indicator.parentElement !== container) {
        container.style.position = container.style.position || "relative";
        container.appendChild(indicator);
      }

      const volPercent = Math.round(video.volume * 100);
      indicator.innerText = `${volPercent}%`;
      indicator.style.display = "block";

      // Clear existing timeout and hide after 1.5 seconds of inactivity
      clearTimeout(hideTimeout);
      hideTimeout = setTimeout(() => {
        indicator.style.display = "none";
      }, 1500);
    },
    { passive: false, capture: true },
  );
})();
