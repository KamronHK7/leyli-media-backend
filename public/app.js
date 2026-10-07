(() => {
  const tg = window.Telegram && window.Telegram.WebApp;
  const params = new URLSearchParams(location.search);
  const preview = params.get("preview");
  const API_BASE = /github\.io$/i.test(location.hostname)
    ? "https://leyli-media-backend.onrender.com"
    : "";
  const startPage = params.get("page") || "about";

  const screens = {
    loading: document.getElementById("screen-loading"),
    error: document.getElementById("screen-error"),
    plans: document.getElementById("page-plans"),
    pay: document.getElementById("page-pay"),
    done: document.getElementById("page-done"),
    panel: document.getElementById("page-panel"),
    about: document.getElementById("page-about")
  };

  const DETAIL_TEXT =
    "Obuna sotib olganingizda, agar sizda avvaldan obuna mavjud bo‘lsa, yangisi eski obunangizga qo‘shib ketiladi. Obuna muddati siz qaysi sanada xarid qilgan bo‘lsangiz, o‘sha kundan boshlab keyingi oy shu sanagacha amal qiladi.";

  let state = {
    user: null,
    plans: [],
    checkoutUrls: {},
    subscription: null,
    selectedPlanId: null,
    supportUrl: "",
    brand: {
      name: "LEYLI MEDIA",
      bot_username: "LeyliMedia_bot",
      instagram_url: "",
      youtube_url: ""
    }
  };

  function show(name) {
    Object.entries(screens).forEach(([key, el]) => {
      el.classList.toggle("hidden", key !== name);
    });
  }

  function formatSom(value) {
    return new Intl.NumberFormat("fr-FR").format(value) + " so‘m";
  }

  function formatDate(iso) {
    return new Date(iso).toLocaleDateString("ru-RU", {
      timeZone: "Asia/Tashkent",
      day: "2-digit",
      month: "2-digit",
      year: "numeric"
    });
  }

  function selectedPlan() {
    return state.plans.find((plan) => plan.id === state.selectedPlanId) || null;
  }

  function isActive() {
    return Boolean(state.subscription && state.subscription.active);
  }

  async function api(path, options = {}) {
    const res = await fetch(API_BASE + path, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        Authorization: "tma " + (tg ? tg.initData : ""),
        ...(options.headers || {})
      }
    });

    const body = await res.json().catch(() => ({}));

    if (!res.ok || body.ok === false) {
      throw new Error(body.error || "request_failed");
    }

    return body;
  }

  function applyBrand() {
    const help = document.getElementById("menu-help");
    if (state.supportUrl) {
      help.href = state.supportUrl;
      help.classList.remove("hidden");
    }

    const ig = document.getElementById("menu-ig");
    if (state.brand.instagram_url) {
      ig.href = state.brand.instagram_url;
      ig.classList.remove("hidden");
    }

    const yt = document.getElementById("menu-yt");
    if (state.brand.youtube_url) {
      yt.href = state.brand.youtube_url;
      yt.classList.remove("hidden");
    }

    const extra = document.getElementById("menu-links");
    extra.classList.toggle(
      "hidden",
      !Boolean(state.supportUrl || state.brand.instagram_url || state.brand.youtube_url)
    );
  }

  function renderPlans() {
    const box = document.getElementById("plans");
    box.innerHTML = "";

    state.plans.forEach((plan) => {
      const selected = plan.id === state.selectedPlanId;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "plan" + (selected ? " selected" : "");
      btn.innerHTML =
        '<span class="plan-left"><span class="dot">' + (selected ? "✓" : "") + "</span>" +
        plan.title +
        '</span><span class="plan-price">' +
        (plan.old_price ? '<span class="old">' + formatSom(plan.old_price) + "</span>" : "") +
        formatSom(plan.price) +
        "</span>";
      btn.addEventListener("click", () => {
        haptic("select");
        state.selectedPlanId = plan.id;
        renderPlans();
      });
      box.appendChild(btn);
    });

    document.getElementById("buy-btn").disabled = !state.selectedPlanId;
  }

  function renderPay() {
    const plan = selectedPlan() || state.plans[0];
    if (!plan) {
      return;
    }

    if (!state.selectedPlanId) {
      state.selectedPlanId = plan.id;
    }

    document.getElementById("amount-view").textContent = formatSom(plan.price);

    const chips = document.getElementById("amount-chips");
    chips.innerHTML = "";
    state.plans.forEach((item) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "chip" + (item.id === state.selectedPlanId ? " selected" : "");
      chip.textContent = formatSom(item.price);
      chip.addEventListener("click", () => {
        haptic("select");
        state.selectedPlanId = item.id;
        renderPay();
      });
      chips.appendChild(chip);
    });
  }

  function renderPanel() {
    document.getElementById("panel-id").textContent = state.user ? "ID: " + state.user.id : "";
    document.getElementById("panel-status").textContent = isActive()
      ? formatDate(state.subscription.expires_at) + " gacha"
      : "Faol emas";
    document.getElementById("link-btn").disabled = !isActive();
  }

  function hideNativeButton() {
    if (tg && tg.MainButton) {
      tg.MainButton.hide();
    }
  }

  function applyTelegramTheme() {
    if (!tg) {
      return;
    }

    try {
      tg.ready();
    } catch (error) {
      /* ready oldin chaqirilgan bo‘lishi mumkin */
    }

    try {
      tg.expand();
    } catch (error) {
      /* expand yo‘q versiyalar */
    }

    hideNativeButton();

    const color = "#1c1c1e";

    try {
      tg.setHeaderColor(color);
    } catch (error) {
      /* eski Telegram */
    }

    try {
      tg.setBackgroundColor(color);
    } catch (error) {
      /* eski Telegram */
    }

    try {
      if (tg.setBottomBarColor) {
        tg.setBottomBarColor(color);
      }
    } catch (error) {
      /* bottom bar yo‘q */
    }

    try {
      if (tg.disableVerticalSwipes) {
        tg.disableVerticalSwipes();
      }
    } catch (error) {
      /* swipes sozlamasi yo‘q */
    }
  }

  function bindBackButton() {
    if (!tg || !tg.BackButton || bindBackButton.done) {
      return;
    }

    bindBackButton.done = true;
    tg.BackButton.onClick(() => {
      haptic("light");
      showPage("plans");
    });
  }

  function syncBackButton(name) {
    if (!tg || !tg.BackButton) {
      return;
    }

    if (name === "pay" || name === "done" || name === "panel" || name === "about") {
      tg.BackButton.show();
    } else {
      tg.BackButton.hide();
    }
  }

  function haptic(kind) {
    try {
      if (!tg || !tg.HapticFeedback) {
        return;
      }

      if (kind === "select") {
        tg.HapticFeedback.selectionChanged();
        return;
      }

      tg.HapticFeedback.impactOccurred(kind || "light");
    } catch (error) {
      /* haptic yo‘q qurilmalarda o‘tkazib yuboriladi */
    }
  }

  function showPage(name) {
    if (name === "panel") {
      renderPanel();
    } else if (name === "pay") {
      renderPay();
    } else if (name === "plans") {
      renderPlans();
    } else if (name === "done") {
      renderDone();
    }

    show(name);
    hideNativeButton();
    syncBackButton(name);
  }

  function openModal(text) {
    document.getElementById("modal-text").textContent = text;
    document.getElementById("modal").classList.remove("hidden");
  }

  function closeModal() {
    document.getElementById("modal").classList.add("hidden");
  }

  function openPayme(url) {
    // Payme GET checkout: checkout.paycom.uz/{base64} — ilovada to'lov sahifasi.
    if (tg && typeof tg.openLink === "function") {
      try {
        tg.openLink(url, { try_instant_view: false });
        return;
      } catch (error) {
        tg.openLink(url);
        return;
      }
    }

    window.location.assign(url);
  }

  async function checkout() {
    const plan = selectedPlan();
    if (!plan) {
      openModal("Avval to‘lov summasini tanlang.");
      return;
    }

    if (preview) {
      openModal(
        "Tanlangan summa: " +
          formatSom(plan.price) +
          ". Bot orqali ochilganda shu summa bilan Payme ochiladi."
      );
      return;
    }

    const readyUrl = state.checkoutUrls[plan.id];
    if (readyUrl) {
      openPayme(readyUrl);
      return;
    }

    const buttons = [
      document.getElementById("pay-next"),
      document.getElementById("payme-btn"),
      document.getElementById("buy-btn")
    ].filter(Boolean);
    buttons.forEach((btn) => {
      btn.disabled = true;
    });

    try {
      const data = await api("/api/checkout", {
        method: "POST",
        body: JSON.stringify({ plan_id: plan.id })
      });

      if (!data.url) {
        throw new Error("no_checkout_url");
      }

      state.checkoutUrls[plan.id] = data.url;
      openPayme(data.url);
    } catch (error) {
      const reason = error && error.message ? String(error.message) : "";
      if (reason === "payment_not_configured") {
        openModal("Payme hali sozlanmagan. Keyinroq urinib ko‘ring.");
      } else if (reason === "unauthorized") {
        openModal("Mini ilovani bot orqali qayta oching.");
      } else {
        openModal("To‘lovni ochib bo‘lmadi. Qayta urinib ko‘ring.");
      }
    } finally {
      buttons.forEach((btn) => {
        btn.disabled = false;
      });
    }
  }

  function renderDone() {
    const status = document.getElementById("done-status");
    const hint = document.getElementById("done-hint");
    const linkBtn = document.getElementById("done-link");

    if (isActive()) {
      status.textContent = "To‘lov qabul qilindi";
      hint.textContent =
        "Bir martalik kanal havolasi botga yuboriladi. Tugma bilan ham so‘rashingiz mumkin.";
      linkBtn.disabled = false;
    } else {
      status.textContent = "To‘lov tekshirilmoqda";
      hint.textContent =
        "Payme tasdiqlagach obuna avtomatik beriladi va bot kanal havolasini yuboradi. Birozdan so‘ng yangilang.";
      linkBtn.disabled = true;
    }
  }

  function setLinkButtonsDisabled(disabled) {
    const buttons = [document.getElementById("link-btn"), document.getElementById("done-link")];
    buttons.forEach((btn) => {
      if (btn) {
        btn.disabled = disabled;
      }
    });
  }

  async function sendLink() {
    if (preview || !isActive()) {
      return;
    }

    setLinkButtonsDisabled(true);

    try {
      await api("/api/send-link", { method: "POST", body: "{}" });
      if (tg) tg.close();
    } catch (error) {
      openModal("Havolani yuborib bo‘lmadi.");
    } finally {
      setLinkButtonsDisabled(!isActive());
    }
  }

  async function loadMe() {
    const data = await api("/api/me");
    state.user = data.user;
    state.plans = data.plans;
    state.checkoutUrls = data.checkout_urls || {};
    state.subscription = data.subscription;
    state.supportUrl = data.support_url || "";
    state.brand = data.brand || state.brand;
    applyBrand();
  }

  function loadPreview(kind) {
    state.user = { id: "7279073491", first_name: "Kamron", username: "Kamron_HK7" };
    state.plans = [
      { id: "month_1", title: "1 oylik", days: 30, price: 20000, old_price: null },
      { id: "month_6", title: "6 oylik", days: 180, price: 109000, old_price: 120000 }
    ];
    state.selectedPlanId = null;
    state.supportUrl = "https://t.me/LeyliMedia_bot";
    state.brand = {
      name: "LEYLI MEDIA",
      bot_username: "LeyliMedia_bot",
      instagram_url: "https://instagram.com/",
      youtube_url: "https://youtube.com/"
    };
    state.subscription =
      kind === "active"
        ? { active: true, expires_at: "2026-11-06T00:00:00.000Z", plan_id: "month_1" }
        : { active: false, expires_at: null, plan_id: null };
    applyBrand();
  }

  async function boot() {
    if (preview) {
      loadPreview(preview);
      if (startPage === "panel" || preview === "active") {
        showPage("panel");
      } else {
        showPage(startPage);
      }
      return;
    }

    if (!tg || !tg.initData) {
      show("error");
      return;
    }

    applyTelegramTheme();
    bindBackButton();

    try {
      await loadMe();
    } catch (error) {
      show("error");
      return;
    }

    const paidReturn =
      params.get("paid") === "1" || location.pathname.replace(/\/+$/, "") === "/paid";

    if (paidReturn) {
      showPage("done");

      if (isActive()) {
        try {
          await api("/api/send-link", { method: "POST", body: "{}" });
        } catch (error) {
          /* bot PerformTransaction paytida ham yuborgan bo‘lishi mumkin */
        }
      }

      return;
    }

    showPage(startPage);
  }

  document.getElementById("buy-btn").addEventListener("click", () => {
    if (!selectedPlan()) {
      return;
    }

    haptic("medium");
    showPage("pay");
  });
  document.getElementById("pay-next").addEventListener("click", () => {
    haptic("medium");
    checkout();
  });
  document.getElementById("payme-btn").addEventListener("click", () => {
    haptic("medium");
    checkout();
  });
  document.getElementById("pay-back").addEventListener("click", () => {
    haptic("light");
    showPage("plans");
  });
  document.getElementById("detail-btn").addEventListener("click", () => {
    haptic("light");
    openModal(DETAIL_TEXT);
  });
  document.getElementById("done-back").addEventListener("click", () => showPage("plans"));
  document.getElementById("done-link").addEventListener("click", async () => {
    if (!preview && !isActive()) {
      try {
        await loadMe();
        renderDone();
      } catch (error) {
        openModal("Holatni yangilab bo‘lmadi.");
        return;
      }
    }

    await sendLink();
  });
  document.getElementById("about-buy").addEventListener("click", () => showPage("plans"));
  document.getElementById("panel-buy-btn").addEventListener("click", () => showPage("plans"));
  document.getElementById("link-btn").addEventListener("click", sendLink);
  document.getElementById("menu-pay").addEventListener("click", () => showPage("pay"));
  document.getElementById("menu-subs").addEventListener("click", () => {
    openModal(
      isActive()
        ? "Obunangiz " + formatDate(state.subscription.expires_at) + " gacha faol."
        : "Hozircha faol obuna yo‘q."
    );
  });
  document.getElementById("modal-close").addEventListener("click", closeModal);
  document.getElementById("modal-x").addEventListener("click", closeModal);
  document.getElementById("refresh-btn").addEventListener("click", async () => {
    if (preview) {
      return;
    }

    try {
      await loadMe();
      renderPanel();
    } catch (error) {
      openModal("Ma’lumotni yangilab bo‘lmadi.");
    }
  });

  boot();
})();
