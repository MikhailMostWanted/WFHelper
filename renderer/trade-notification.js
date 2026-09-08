/* Trade Notification Overlay - renderer logic */
(function () {
  "use strict";

  const WFM_ASSET_BASE = "https://warframe.market/static/assets/";

  const STATUS_KEYS = {
    closed: "overlay.trade.listingClosed",
    "no-match": "overlay.trade.noListingMatched",
    "close-failed": "overlay.trade.closingFailed",
    detected: "overlay.trade.tradeFinished",
  };

  const REP_RESULT_LABELS = {
    sent: { key: "overlay.trade.repSent", cls: "ok" },
    "already-exists": { key: "overlay.trade.repAlready", cls: "ok" },
    "user-not-found": { key: "overlay.trade.repNotFound", cls: "err" },
    failed: { key: "overlay.trade.repFailed", cls: "err" },
  };

  const notification = document.getElementById("notification");
  const itemThumb = document.getElementById("item-thumb");
  const tradeLabel = document.getElementById("trade-label");
  const tradeBadge = document.getElementById("trade-badge");
  const itemName = document.getElementById("item-name");
  const platAmount = document.getElementById("plat-amount");
  const partnerName = document.getElementById("partner-name");
  const repLine = document.getElementById("rep-line");

  let dismissTimer = null;
  let fadeTimer = null;
  // Last rendered payloads, so a language change repaints the visible toast.
  let lastNotification = null;
  let lastRepResult = null;

  const t = window.overlayI18n.t;

  function scheduleDismiss(visibleMs, fadeMs) {
    if (dismissTimer) clearTimeout(dismissTimer);
    if (fadeTimer) clearTimeout(fadeTimer);
    dismissTimer = setTimeout(function () {
      dismissTimer = null;
      notification.classList.add("fade-out");
      fadeTimer = setTimeout(function () {
        fadeTimer = null;
        notification.classList.add("hidden");
        window.tradeNotificationApi.dismiss();
      }, fadeMs);
    }, visibleMs);
  }

  function renderNotification(payload) {
    const match = payload.match;

    if (match.itemThumb) {
      const src = match.itemThumb.startsWith("http")
        ? match.itemThumb
        : WFM_ASSET_BASE + match.itemThumb;
      itemThumb.src = src;
      itemThumb.style.display = "block";
    } else {
      itemThumb.src = "";
      itemThumb.style.display = "none";
    }

    const status = STATUS_KEYS[payload.status] ? payload.status : "detected";
    tradeLabel.textContent = t(STATUS_KEYS[status]);
    tradeLabel.className = status === "closed" ? "closed" : "unmatched";

    const isSale = match.type === "sale";
    const isPurchase = match.type === "purchase";
    tradeBadge.textContent = isSale
      ? t("stats.filterSale")
      : isPurchase
        ? t("stats.filterPurchase")
        : t("stats.filterTrade");
    tradeBadge.className = isSale ? "sale" : isPurchase ? "purchase" : "trade";

    const qty = match.quantity > 1 ? match.quantity + "× " : "";
    itemName.textContent = qty + (match.itemName || t("overlay.trade.unknownItem"));

    const showPlatinum = (isSale || isPurchase) && match.platinum > 0;
    platAmount.hidden = !showPlatinum;
    if (showPlatinum) {
      platAmount.textContent = (isSale ? "+" : "−") + match.platinum + "p";
      platAmount.className = isSale ? "positive" : "negative";
    }

    partnerName.textContent = match.partner || "";

    const rep = payload.rep;
    if (rep && rep.partner && rep.hotkey) {
      repLine.textContent = t("overlay.trade.repOffer", {
        hotkey: rep.hotkey,
        partner: rep.partner,
      });
      repLine.className = "offer";
      repLine.hidden = false;
    } else {
      repLine.textContent = "";
      repLine.hidden = true;
    }
  }

  function showNotification(payload) {
    if (!payload || !payload.match) return;

    lastNotification = payload;
    lastRepResult = null;
    renderNotification(payload);

    // Show with animation
    notification.classList.remove("hidden", "fade-out");

    scheduleDismiss(payload.timing.visibleMs, payload.timing.fadeMs);
  }

  function renderRepResult(payload) {
    const label = REP_RESULT_LABELS[payload.result] || REP_RESULT_LABELS.failed;
    repLine.textContent = t(label.key, { partner: payload.partner || "" });
    repLine.className = label.cls;
    repLine.hidden = false;
  }

  function showRepResult(payload) {
    if (!payload) return;
    lastRepResult = payload;
    renderRepResult(payload);

    notification.classList.remove("hidden", "fade-out");
    scheduleDismiss(payload.timing.visibleMs, payload.timing.fadeMs);
  }

  let messagesLoaded = false;
  let pendingShow = null;
  let pendingRepResult = null;

  function flushPending() {
    if (pendingShow) showNotification(pendingShow);
    if (pendingRepResult) showRepResult(pendingRepResult);
    pendingShow = null;
    pendingRepResult = null;
  }

  window.tradeNotificationApi.onShow(function (payload) {
    if (messagesLoaded) showNotification(payload);
    else pendingShow = payload;
  });

  window.tradeNotificationApi.onRepResult(function (payload) {
    if (messagesLoaded) showRepResult(payload);
    else pendingRepResult = payload;
  });

  window.tradeNotificationApi.onMessages(function (messages) {
    if (!window.overlayI18n.apply(messages)) return;
    messagesLoaded = true;
    flushPending();
  });

  // Repaint without restarting the dismiss timer the toast is already running on.
  window.overlayI18n.onApply(function () {
    if (lastNotification) renderNotification(lastNotification);
    if (lastRepResult) renderRepResult(lastRepResult);
  });

  void window.overlayI18n
    .load(function () {
      return window.tradeNotificationApi.getMessages();
    })
    .then(function (loaded) {
      if (!loaded) return;
      messagesLoaded = true;
      flushPending();
    });
})();
