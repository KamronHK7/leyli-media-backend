(() => {
  const tg = window.Telegram && window.Telegram.WebApp;
  const screens = {
    loading: document.getElementById("screen-loading"),
    error: document.getElementById("screen-error"),
    home: document.getElementById("screen-home"),
    pay: document.getElementById("screen-pay"),
    active: document.getElementById("screen-active")
  };

  let state = {
    plans: [],
    subscription: null,
    selectedPlanId: null,
    paymentReady: false
  };

  const preview = new URLSearchParams(location.search).get("preview");

  function show(name) {
    Object.entries(screens).forEach(([key, el]) => {
      el.classList.toggle("hidden", key !== name);
    });

    if (tg && tg.BackButton) {
      if (name === "pay") {
        tg.BackButton.show();
      } else {
        tg.BackButton.hide();
      }
    }
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
    return state.plans.find((plan) => plan.id === state.selectedPlanId) || state.plans[0];
  }

  async function api(path, options = {}) {
    const res = await fetch(path, {
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

  function renderHome() {
    show("home");
  }

  function renderPay() {
    document.getElementById("pay-btn").disabled = !state.paymentReady && !preview;
    show("pay");
  }

  function renderActive() {
    document.getElementById("active-until").textContent =
      "Obuna " + formatDate(state.subscription.expires_at) + " gacha faol.";
    show("active");
  }

  async function loadMe() {
    const data = await api("/api/me");
    state.plans = data.plans;
    state.subscription = data.subscription;
    state.selectedPlanId = (data.plans[0] && data.plans[0].id) || null;
    state.paymentReady = data.payment_ready;
  }

  function loadPreview(kind) {
    state.plans = [{ id: "month_1", title: "1 oylik", days: 30, price: 20000 }];
    state.selectedPlanId = "month_1";
    state.paymentReady = true;
    state.subscription =
      kind === "active"
        ? {
            active: true,
            expires_at: "2026-11-06T00:00:00.000Z",
            plan_id: "month_1"
          }
        : { active: false, expires_at: null, plan_id: null };
  }

  async function checkout() {
    if (preview) {
      return;
    }

    const btn = document.getElementById("pay-btn");
    btn.disabled = true;

    try {
      const data = await api("/api/checkout", {
        method: "POST",
        body: JSON.stringify({ plan_id: selectedPlan().id })
      });

      if (tg && tg.openLink) {
        tg.openLink(data.url);
      } else {
        window.location.href = data.url;
      }
    } catch (error) {
      alert("To‘lovni ochib bo‘lmadi. Qayta urinib ko‘ring.");
    } finally {
      btn.disabled = false;
    }
  }

  async function sendLink() {
    if (preview) {
      return;
    }

    const btn = document.getElementById("link-btn");
    btn.disabled = true;

    try {
      await api("/api/send-link", { method: "POST", body: "{}" });
      if (tg) tg.close();
    } catch (error) {
      alert("Havolani yuborib bo‘lmadi. Botda «Obunani tekshirish»ni bosing.");
    } finally {
      btn.disabled = false;
    }
  }

  async function boot() {
    if (preview) {
      loadPreview(preview);
      if (state.subscription.active) {
        renderActive();
      } else {
        renderHome();
      }
      return;
    }

    if (!tg || !tg.initData) {
      show("error");
      return;
    }

    tg.ready();
    tg.expand();
    try {
      tg.setHeaderColor("#050505");
      tg.setBackgroundColor("#050505");
    } catch (error) {
      /* eski Telegram versiyalarida rang sozlamasi bo‘lmasligi mumkin */
    }

    if (tg.BackButton) {
      tg.BackButton.onClick(renderHome);
    }

    try {
      await loadMe();
    } catch (error) {
      show("error");
      return;
    }

    if (state.subscription && state.subscription.active) {
      renderActive();
    } else {
      renderHome();
    }
  }

  document.getElementById("buy-btn").addEventListener("click", renderPay);
  document.getElementById("pay-btn").addEventListener("click", checkout);
  document.getElementById("link-btn").addEventListener("click", sendLink);
  document.getElementById("extend-btn").addEventListener("click", renderPay);

  boot();
})();
