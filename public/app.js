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
    user: null,
    plans: [],
    subscription: null,
    selectedPlanId: null,
    paymentReady: false
  };

  function show(name) {
    Object.entries(screens).forEach(([key, el]) => {
      el.classList.toggle("hidden", key !== name);
    });
  }

  function formatSom(value) {
    return new Intl.NumberFormat("uz-UZ").format(value) + " so‘m";
  }

  function formatDate(iso) {
    return new Date(iso).toLocaleDateString("ru-RU", {
      timeZone: "Asia/Tashkent",
      day: "2-digit",
      month: "2-digit",
      year: "numeric"
    });
  }

  function fullName(user) {
    return [user.first_name, user.last_name].filter(Boolean).join(" ") || "Telegram foydalanuvchi";
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

  function renderPlans() {
    const box = document.getElementById("plans");
    box.innerHTML = "";

    state.plans.forEach((plan) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "plan" + (plan.id === state.selectedPlanId ? " selected" : "");
      btn.innerHTML =
        '<span class="plan-title">' + plan.title + "</span>" +
        '<span class="plan-price">' + formatSom(plan.price) + "</span>";
      btn.addEventListener("click", () => {
        state.selectedPlanId = plan.id;
        renderPlans();
      });
      box.appendChild(btn);
    });
  }

  function renderHome() {
    const user = state.user;
    document.getElementById("hello").textContent =
      "Assalomu alaykum, " + fullName(user) + "!";

    if (state.subscription && state.subscription.active) {
      document.getElementById("status-line").textContent =
        "Obunangiz " + formatDate(state.subscription.expires_at) + " gacha faol.";
    } else {
      document.getElementById("status-line").textContent =
        "Hozirda faol obuna yo‘q.";
    }

    renderPlans();
    show("home");
  }

  function renderPay() {
    const user = state.user;
    const plan = selectedPlan();

    document.getElementById("pay-name").textContent = fullName(user);
    document.getElementById("pay-user").textContent = user.username
      ? "@" + user.username
      : "—";
    document.getElementById("pay-id").textContent = user.id;
    document.getElementById("pay-plan").textContent = plan.title;
    document.getElementById("pay-amount").textContent = formatSom(plan.price);
    document.getElementById("pay-btn").disabled = !state.paymentReady;
    show("pay");
  }

  function renderActive() {
    document.getElementById("active-until").textContent =
      "Obuna " + formatDate(state.subscription.expires_at) +
      " gacha amal qiladi. Kanal havolasi botga yuboriladi.";
    show("active");
  }

  async function loadMe() {
    const data = await api("/api/me");
    state.user = data.user;
    state.plans = data.plans;
    state.subscription = data.subscription;
    state.selectedPlanId = (data.plans[0] && data.plans[0].id) || null;
    state.paymentReady = data.payment_ready;
  }

  const preview = new URLSearchParams(location.search).get("preview");

  function loadPreview(kind) {
    state.user = {
      id: "7279073491",
      first_name: "Kamron",
      last_name: "",
      username: "Kamron_HK7",
      photo_url: ""
    };
    state.plans = [{ id: "month_1", title: "1 oylik", days: 30, price: 20000 }];
    state.selectedPlanId = "month_1";
    state.paymentReady = false;
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
      alert("Bu faqat dizayn ko‘rinishi. Haqiqiy to‘lov Telegram mini appda ishlaydi.");
      return;
    }

    const btn = document.getElementById("pay-btn");
    btn.disabled = true;
    btn.textContent = "Havola tayyorlanmoqda...";

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
      alert("To‘lov havolasini ochib bo‘lmadi. Qayta urinib ko‘ring.");
    } finally {
      btn.disabled = false;
      btn.textContent = "Payme orqali to‘lash";
    }
  }

  async function sendLink() {
    if (preview) {
      alert("Bu faqat dizayn ko‘rinishi. Kanal havolasi bot orqali yuboriladi.");
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

    try {
      await loadMe();
    } catch (error) {
      show("error");
      return;
    }

    const paid = new URLSearchParams(location.search).get("paid") === "1";

    if (paid) {
      document.getElementById("status-line").textContent =
        "To‘lov tekshirilmoqda. Bir necha soniyadan so‘ng obuna faollashadi.";
    }

    if (state.subscription && state.subscription.active) {
      renderActive();
    } else {
      renderHome();
    }
  }

  document.getElementById("buy-btn").addEventListener("click", renderPay);
  document.getElementById("back-btn").addEventListener("click", renderHome);
  document.getElementById("pay-btn").addEventListener("click", checkout);
  document.getElementById("link-btn").addEventListener("click", sendLink);
  document.getElementById("extend-btn").addEventListener("click", renderPay);

  boot();
})();
