(function () {
  window.installRewardLayout = function installRewardLayout(options) {
    let state = null;
    let frame = 0;
    let gesture = null;
    const commands = [];
    let inFlight = null;
    let sending = false;
    const drains = [];

    function editing() {
      return Boolean(state?.sessionId);
    }

    function tag(root, selector, field) {
      const element = root.querySelector(selector);
      if (element) element.dataset.rewardField = field;
    }

    function tagFields() {
      for (const card of document.querySelectorAll(".reward-slot")) {
        for (const [selector, field] of Object.entries({
          ".slot-player": "slotLabel",
          ".slot-name": "itemName",
          ".slot-rarity": "rarity",
          ".slot-plat-value .currency-icon": "platinumIcon",
          ".slot-plat-value > span:last-child": "platinumValue",
          ".slot-ducat-value .currency-icon": "ducatIcon",
          ".slot-ducat-value > span:last-child": "ducatValue",
          ".slot-price-placeholder": "pricePlaceholder",
          ".slot-meta-chip.owned": "owned",
          ".slot-meta-chip.mastered, .slot-meta-chip.unmastered": "mastery",
          ".slot-meta-chip.building": "foundry",
          ".slot-meta-chip.set": "setOwned",
          ".slot-meta-chip.set-price": "setPrice",
        }))
          tag(card, selector, field);
        const parts = card.querySelectorAll(".slot-set-part");
        parts.forEach((part, index) => {
          tag(part, ".slot-set-part-icon", `part${index}Icon`);
          tag(part, ".slot-set-part-count", `part${index}Count`);
        });
      }
      for (const [selector, field] of Object.entries({
        "#best-label": "bestLabel",
        "#best-value > span:not(.footer-currency-value):not(.best-placeholder)": "bestName",
        ".footer-plat-value .currency-icon": "bestPlatinumIcon",
        ".footer-plat-value > span:last-child": "bestPlatinumValue",
        ".best-placeholder": "bestPlaceholder",
        ".scan-spinner": "scanSpinner",
        "#scanning-text": "scanText",
        "#error-banner": "errorText",
        "#drag-hint": "dragHint",
        "#btn-close": "closeButton",
      }))
        tag(document, selector, field);
    }

    function scheduleLayout() {
      if (!frame) frame = requestAnimationFrame(applyLayout);
    }

    function applyLayout() {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      tagFields();
      const elements = [...document.querySelectorAll("[data-reward-field]")];
      document.body.classList.toggle("reward-layout-editing", editing());
      for (const element of elements) {
        const field = element.dataset.rewardField;
        const style = state?.layout.fields[field];
        element.classList.toggle("reward-field-hidden", style?.hidden === true);
        element.classList.toggle(
          "reward-field-selected",
          editing() && state.selectedField === field,
        );
        element.style.transform = "";
        element.style.translate = "";
        element.style.scale = "";
        if (field === "itemName" || field === "errorText") {
          element.style.width = style && style.scale !== 1 ? `${100 / style.scale}%` : "";
        }
        element.style.color = style?.color || "";
        element.style.backgroundColor = "";
        element.style.maskImage = "";
        element.style.maskMode = "luminance";
        if (field === "scanSpinner") element.style.borderTopColor = style?.color || "";
        const fallback = element.querySelector(".slot-set-part-fallback");
        if (fallback) fallback.style.color = style?.color || "";
        const image = element.querySelector("img");
        if (image) {
          image.style.visibility = "";
          if (style?.color) {
            element.style.backgroundColor = style.color;
            element.style.maskImage = `url("${image.src.replaceAll('"', "%22")}")`;
            image.style.visibility = "hidden";
          }
        }
      }
      const panel = document.getElementById("panel").getBoundingClientRect();
      const positions = [];
      const limits = new Map();
      const resolved = new Set();
      for (const element of elements) {
        const field = element.dataset.rewardField;
        const style = state?.layout.fields[field];
        if (!style || style.hidden || !element.getClientRects().length) continue;
        const rect = element.getBoundingClientRect();
        if (!rect.width || !rect.height) continue;
        const card = element.closest(".reward-slot")?.getBoundingClientRect();
        const bounds = card || panel;
        const left = Math.max(bounds.left, panel.left) + 3;
        const top = Math.max(bounds.top, panel.top) + 3;
        const right = Math.min(bounds.right, panel.right) - 3;
        const bottom = Math.min(bounds.bottom, panel.bottom) - 3;
        const scale = Math.min(
          style.scale,
          (right - left) / rect.width,
          (bottom - top) / rect.height,
        );
        const previous = limits.get(field);
        const range = {
          minX: Math.max(left - rect.left, previous?.minX ?? -Infinity),
          maxX: Infinity,
          minY: Math.max(top - rect.top, previous?.minY ?? -Infinity),
          maxY: Infinity,
        };
        limits.set(field, range);
        positions.push({
          element,
          field,
          style,
          scale,
          width: rect.width,
          height: rect.height,
          right: right - rect.left,
          bottom: bottom - rect.top,
        });
      }
      for (const position of positions) {
        const range = limits.get(position.field);
        position.scale = Math.min(
          position.scale,
          (position.right - range.minX) / position.width,
          (position.bottom - range.minY) / position.height,
        );
        range.maxX = Math.min(range.maxX, position.right - position.width * position.scale);
        range.maxY = Math.min(range.maxY, position.bottom - position.height * position.scale);
      }
      for (const { element, field, style, scale } of positions) {
        // A shared offset must fit every visible reward card.
        const range = limits.get(field);
        const x = Math.max(range.minX, Math.min(range.maxX, style.x));
        const y = Math.max(range.minY, Math.min(range.maxY, style.y));
        // Individual properties preserve the spinner's rotation animation.
        element.style.scale = String(Math.max(0.05, scale));
        element.style.translate = `${x}px ${y}px`;
        if (editing() && !resolved.has(field)) {
          resolved.add(field);
          const patch = { x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 };
          if (patch.x !== style.x || patch.y !== style.y) {
            state.layout.fields[field] = { ...style, ...patch };
            if (gesture?.field !== field) send({ type: "field", field, patch });
          }
        }
      }
    }

    function accept(next) {
      if (!next?.layout || (state && next.revision < state.revision)) return;
      next = structuredClone(next);
      const previous = state;
      if (previous?.sessionId === next.sessionId) {
        for (const command of [inFlight, ...commands]) {
          if (command?.type === "field") {
            next.layout.fields[command.field] = {
              ...options.defaultFieldStyle,
              ...next.layout.fields[command.field],
              ...command.patch,
            };
          }
        }
        if (gesture?.field) {
          next.layout.fields[gesture.field] = previous.layout.fields[gesture.field];
        }
      }
      state = next;
      if (next.sessionId) {
        if (
          previous?.sessionId !== next.sessionId ||
          previous.previewCount !== next.previewCount ||
          previous.previewVariant !== next.previewVariant
        ) {
          gesture = null;
          options.renderPreview(next);
        }
      } else if (previous?.sessionId) {
        gesture = null;
        commands.length = 0;
        options.resetPreview();
      }
      scheduleLayout();
    }

    async function sendPending() {
      if (sending || !commands.length || !state?.sessionId) return;
      sending = true;
      const sessionId = state.sessionId;
      const command = commands.shift();
      inFlight = command;
      let failure = null;
      try {
        const next = await window.overlay.editRewardLayout(sessionId, command);
        inFlight = null;
        if (state?.sessionId === sessionId && !gesture) {
          accept(next);
          applyLayout();
        }
      } catch (error) {
        failure = error;
        if (state?.sessionId === sessionId) commands.unshift(command);
        console.warn("[Overlay] reward layout edit failed", String(error));
      } finally {
        inFlight = null;
        sending = false;
        if (!failure && commands.length) void sendPending();
        else {
          for (const waiter of drains.splice(0)) {
            if (failure) waiter.reject(failure);
            else waiter.resolve();
          }
        }
      }
    }

    function send(command) {
      const last = commands[commands.length - 1];
      if (command.type === "field" && last?.type === "field" && last.field === command.field) {
        last.patch = { ...last.patch, ...command.patch };
      } else commands.push(command);
      void sendPending();
    }

    document.addEventListener(
      "pointerdown",
      (event) => {
        if (!editing() || event.button !== 0) return;
        const target =
          event.target instanceof Element ? event.target.closest("[data-reward-field]") : null;
        if (!target) return;
        event.preventDefault();
        event.stopPropagation();
        const field = target.dataset.rewardField;
        const style = state.layout.fields[field] || options.defaultFieldStyle;
        const offset = field
          ? getComputedStyle(target).translate.split(" ").map(Number.parseFloat)
          : [];
        gesture = {
          field,
          x: event.clientX,
          y: event.clientY,
          style: {
            ...style,
            x: Number.isFinite(offset[0]) ? offset[0] : 0,
            y: Number.isFinite(offset[1]) ? offset[1] : 0,
          },
        };
        if (field) {
          state = { ...state, selectedField: field };
          send({ type: "select", field });
          scheduleLayout();
        }
        target.setPointerCapture(event.pointerId);
      },
      true,
    );

    document.addEventListener("pointermove", (event) => {
      if (!gesture || !editing()) return;
      if (!(event.buttons & 1)) {
        finishGesture();
        return;
      }
      if (gesture.field) {
        const patch = {
          x: gesture.style.x + event.clientX - gesture.x,
          y: gesture.style.y + event.clientY - gesture.y,
        };
        state.layout.fields[gesture.field] = { ...gesture.style, ...patch };
        applyLayout();
        const positioned = state.layout.fields[gesture.field];
        send({ type: "field", field: gesture.field, patch: { x: positioned.x, y: positioned.y } });
      }
    });

    function finishGesture() {
      gesture = null;
      void sendPending();
    }
    document.addEventListener("pointerup", finishGesture);
    document.addEventListener("pointercancel", finishGesture);
    document.addEventListener("lostpointercapture", finishGesture);
    window.addEventListener("blur", finishGesture);
    document.addEventListener("contextmenu", (event) => {
      if (editing()) event.preventDefault();
    });
    window.addEventListener("resize", scheduleLayout);
    void document.fonts.ready.then(scheduleLayout);
    new MutationObserver(scheduleLayout).observe(document.getElementById("panel"), {
      childList: true,
      subtree: true,
      characterData: true,
    });
    window.overlay.onRewardLayout(accept);
    void window.overlay
      .getRewardLayout()
      .then(accept)
      .catch((error) => {
        console.warn("[Overlay] reward layout unavailable", String(error));
      });
    scheduleLayout();
    return {
      flush: () => {
        gesture = null;
        applyLayout();
        if (!sending && !commands.length) return Promise.resolve();
        return new Promise((resolve, reject) => {
          drains.push({ resolve, reject });
          void sendPending();
        });
      },
      isEditing: editing,
      refresh: scheduleLayout,
      cancel: () => {
        if (state?.sessionId) {
          commands.length = 0;
          void window.overlay
            .endRewardLayout(state.sessionId, false)
            .then(accept)
            .catch((error) => {
              console.warn("[Overlay] reward layout cancel failed", String(error));
            });
        }
      },
    };
  };
})();
