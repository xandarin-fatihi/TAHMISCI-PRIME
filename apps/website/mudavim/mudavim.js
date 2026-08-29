(function initialiseMudavim() {
  "use strict";

  const state = {
    member: null,
    loyalty: emptyLoyalty(),
    announcements: [],
    registerChallengeId: "",
    resetChallengeId: "",
    resetCode: "",
    busy: false,
    activePanel: "welcome"
  };
  const elements = {};
  const featureCopy = {
    qr: ["fa-qrcode", "Dijital QR kart", "Müdavim kartın hesabına güvenle bağlıdır ve gelecekteki ziyaret akışına hazırdır."],
    visits: ["fa-clock-rotate-left", "Ziyaret takibi", "Gerçek ziyaret kayıtların oluştuğunda geçmişin burada gösterilir."],
    mobile: ["fa-mobile-screen-button", "Mobil arayüz", "Mobil cihaz ve masaüstünde aynı güvenli Müdavim hesabını kullanırsın."],
    profile: ["fa-user-shield", "Profil yönetimi", "Profil ve e-posta güvenliği doğrudan backend hesabında saklanır."]
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initialise, { once: true });
  else initialise();

  function initialise() {
    collectElements();
    bindEvents();
    renderGuest();
    void Promise.all([loadPublicMudavim(), restoreSession()]);
  }

  function collectElements() {
    [
      "gate", "app", "mudavimAuthOverlay", "memberProfileOverlay", "memberProfileTrigger", "memberProfileForm",
      "memberProfileSave", "memberProfileFullName", "memberProfileAlias", "memberProfileBirthDate",
      "memberProfileCampaignConsent", "memberProfileStatus", "memberAvatar", "memberFullName", "memberWelcomeName",
      "progressCount", "rewardTarget", "progressText", "visitSummaryLabel", "visitSegments", "memberLevel",
      "tierTrack", "centerMemberLevel", "centerVisitCount", "centerRemaining", "latestVisit", "compactVisitHistory",
      "memberHistoryPanel", "memberAnnouncementFeed", "featurePopover", "featurePopoverTitle", "featurePopoverText"
    ].forEach((id) => { elements[id] = document.getElementById(id); });
    elements.authClose = document.querySelector(".mudavim-auth-close");
  }

  function bindEvents() {
    document.querySelectorAll("[data-auth-open]").forEach((button) => button.addEventListener("click", () => openAuth(button.dataset.authOpen)));
    elements.authClose?.addEventListener("click", closeAuth);
    elements.mudavimAuthOverlay?.addEventListener("click", (event) => {
      if (event.target === elements.mudavimAuthOverlay) closeAuth();
    });
    document.querySelector('[data-auth-step="login"]')?.addEventListener("submit", submitLogin);
    document.querySelector('[data-auth-step="register"]')?.addEventListener("submit", submitRegister);
    document.querySelector('[data-auth-step="verify-email"]')?.addEventListener("submit", confirmRegistration);
    document.querySelector('[data-auth-step="forgot"]')?.addEventListener("submit", requestPasswordReset);
    document.querySelector('[data-auth-step="verify-reset"]')?.addEventListener("submit", acceptResetCode);
    document.querySelector('[data-auth-step="new-password"]')?.addEventListener("submit", confirmPasswordReset);
    document.querySelector("[data-auth-finish]")?.addEventListener("click", () => showAuthStep("login"));
    document.querySelectorAll('[inputmode="numeric"][maxlength="6"]').forEach((input) => {
      input.addEventListener("input", () => { input.value = input.value.replace(/\D/g, "").slice(0, 6); });
    });
    document.querySelectorAll("[data-feature]").forEach((button) => button.addEventListener("click", () => toggleFeature(button)));
    document.querySelectorAll("[data-member-panel]").forEach((button) => button.addEventListener("click", () => showMemberPanel(button.dataset.memberPanel)));
    document.querySelectorAll("[data-member-panel-close]").forEach((button) => button.addEventListener("click", () => showMemberPanel("welcome")));
    elements.memberProfileTrigger?.addEventListener("click", openProfile);
    document.querySelectorAll("[data-profile-close]").forEach((button) => button.addEventListener("click", closeProfile));
    elements.memberProfileOverlay?.addEventListener("click", (event) => {
      if (event.target === elements.memberProfileOverlay) closeProfile();
    });
    elements.memberProfileSave?.addEventListener("click", saveProfile);
    document.querySelector("[data-profile-password-reset]")?.addEventListener("click", () => {
      closeProfile();
      openAuth("forgot");
      const input = document.getElementById("forgotEmail");
      if (input && state.member) input.value = state.member.email || "";
    });
    document.querySelector("[data-logout]")?.addEventListener("click", logout);
    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      if (elements.memberProfileOverlay && !elements.memberProfileOverlay.hidden) closeProfile();
      else if (elements.mudavimAuthOverlay && !elements.mudavimAuthOverlay.hidden) closeAuth();
      else if (elements.featurePopover && !elements.featurePopover.hidden) closeFeature();
    });
  }

  async function loadPublicMudavim() {
    try {
      const payload = await request("/api/public/mudavim", { method: "GET" });
      state.announcements = Array.isArray(payload.mudavim && payload.mudavim.announcements) ? payload.mudavim.announcements : [];
    } catch (_error) {
      state.announcements = [];
    }
    renderAnnouncements();
  }

  async function restoreSession() {
    try {
      const payload = await request("/api/mudavim/me", { method: "GET" });
      enterMember(payload.member, payload.loyalty);
    } catch (_error) {
      renderGuest();
    }
  }

  async function submitLogin(event) {
    event.preventDefault();
    if (state.busy) return;
    const form = event.currentTarget;
    const email = value("loginEmail").toLowerCase();
    const password = value("loginPassword");
    if (!validEmail(email) || !password) return setAuthMessage(form, "Geçerli e-posta ve şifrenizi girin.");
    await withBusy(form, async () => {
      const payload = await request("/api/mudavim/login", { method: "POST", body: { email, password } });
      enterMember(payload.member, payload.loyalty);
      closeAuth();
    });
  }

  async function submitRegister(event) {
    event.preventDefault();
    if (state.busy) return;
    const form = event.currentTarget;
    const body = {
      fullName: value("registerName"),
      email: value("registerEmail").toLowerCase(),
      password: value("registerPassword"),
      passwordConfirm: value("registerPasswordConfirm"),
      termsAccepted: Boolean(document.getElementById("registerTerms")?.checked),
      campaignConsent: Boolean(document.getElementById("registerCampaigns")?.checked)
    };
    if (!body.fullName || !validEmail(body.email)) return setAuthMessage(form, "Ad soyad ve geçerli e-posta gerekli.");
    if (body.password !== body.passwordConfirm) return setAuthMessage(form, "Şifreler eşleşmiyor.");
    await withBusy(form, async () => {
      const payload = await request("/api/mudavim/register", { method: "POST", body });
      state.registerChallengeId = payload.challengeId || "";
      showAuthStep("verify-email");
      focus("registerVerificationCode");
    });
  }

  async function confirmRegistration(event) {
    event.preventDefault();
    if (state.busy) return;
    const form = event.currentTarget;
    const code = value("registerVerificationCode").replace(/\D/g, "");
    if (!state.registerChallengeId || code.length !== 6) return setAuthMessage(form, "Altı haneli kodu girin.");
    await withBusy(form, async () => {
      await request("/api/mudavim/register/confirm", { method: "POST", body: { challengeId: state.registerChallengeId, code } });
      state.registerChallengeId = "";
      showAuthStep("success");
    });
  }

  async function requestPasswordReset(event) {
    event.preventDefault();
    if (state.busy) return;
    const form = event.currentTarget;
    const email = value("forgotEmail").toLowerCase();
    if (!validEmail(email)) return setAuthMessage(form, "Geçerli e-posta adresinizi girin.");
    await withBusy(form, async () => {
      const payload = await request("/api/account/password-reset/mudavim/request", {
        method: "POST", body: { scope: "mudavim", identifier: email }
      });
      state.resetChallengeId = payload.challengeId || "";
      state.resetCode = "";
      showAuthStep("verify-reset");
      focus("resetVerificationCode");
    });
  }

  function acceptResetCode(event) {
    event.preventDefault();
    const code = value("resetVerificationCode").replace(/\D/g, "");
    if (!state.resetChallengeId || code.length !== 6) return setAuthMessage(event.currentTarget, "Altı haneli kodu girin.");
    state.resetCode = code;
    showAuthStep("new-password");
    focus("resetNewPassword");
  }

  async function confirmPasswordReset(event) {
    event.preventDefault();
    if (state.busy) return;
    const form = event.currentTarget;
    const newPassword = value("resetNewPassword");
    const confirmation = value("resetNewPasswordConfirm");
    if (!newPassword || newPassword !== confirmation) return setAuthMessage(form, "Yeni şifreler eşleşmiyor.");
    await withBusy(form, async () => {
      await request("/api/account/password-reset/mudavim/confirm", {
        method: "POST", body: { scope: "mudavim", challengeId: state.resetChallengeId, code: state.resetCode, newPassword }
      });
      state.resetChallengeId = "";
      state.resetCode = "";
      showAuthStep("login");
      setAuthMessage(document.querySelector('[data-auth-step="login"]'), "Şifreniz güncellendi. Giriş yapabilirsiniz.", "success");
    });
  }

  function enterMember(member, loyalty) {
    state.member = member || null;
    state.loyalty = normalizeLoyalty(loyalty);
    document.body.classList.remove("is-guest");
    document.body.classList.add("is-member");
    if (elements.gate) elements.gate.hidden = true;
    if (elements.app) elements.app.hidden = false;
    renderMember();
    document.dispatchEvent(new CustomEvent("mudavim:session-started", { detail: { member: state.member } }));
  }

  function renderGuest() {
    state.member = null;
    state.loyalty = emptyLoyalty();
    document.body.classList.add("is-guest");
    document.body.classList.remove("is-member");
    if (elements.gate) elements.gate.hidden = false;
    if (elements.app) elements.app.hidden = true;
  }

  function renderMember() {
    const member = state.member || {};
    const loyalty = state.loyalty;
    const displayName = member.alias || member.fullName || "Müdavim";
    const initial = displayName.trim().slice(0, 1).toLocaleUpperCase("tr-TR") || "M";
    setText(elements.memberAvatar, initial);
    setText(elements.memberFullName, displayName);
    setText(elements.memberWelcomeName, displayName);
    setText(elements.progressCount, String(loyalty.visitCount));
    setText(elements.rewardTarget, loyalty.available && loyalty.rewardTarget ? ` / ${loyalty.rewardTarget}` : "");
    setText(elements.visitSummaryLabel, loyalty.available ? "ziyaret tamamlandı" : "Henüz ziyaret kaydı yok");
    setText(elements.progressText, loyalty.available && loyalty.rewardTarget
      ? `Bir sonraki ödüle ${Math.max(0, loyalty.rewardTarget - loyalty.visitCount)} ziyaret kaldı.`
      : "Sadakat geçmişi kullanıma açıldığında burada görünecek.");
    setText(elements.memberLevel, loyalty.level || "Henüz yok");
    setText(elements.centerMemberLevel, loyalty.level || "Henüz yok");
    setText(elements.centerVisitCount, String(loyalty.visitCount));
    setText(elements.centerRemaining, loyalty.available && loyalty.rewardTarget
      ? `${Math.max(0, loyalty.rewardTarget - loyalty.visitCount)} ziyaret` : "Veri bekleniyor");
    renderVisitSegments();
    renderVisitHistory();
    renderAnnouncements();
  }

  function renderVisitSegments() {
    if (!elements.visitSegments) return;
    if (!state.loyalty.available || !state.loyalty.rewardTarget) return elements.visitSegments.replaceChildren();
    const fragment = document.createDocumentFragment();
    for (let index = 0; index < state.loyalty.rewardTarget; index += 1) {
      const segment = document.createElement("i");
      segment.className = index < state.loyalty.visitCount ? "is-complete" : "";
      fragment.appendChild(segment);
    }
    elements.visitSegments.replaceChildren(fragment);
  }

  function renderVisitHistory() {
    const visits = state.loyalty.recentVisits;
    const empty = '<div class="member-empty member-empty--panel"><strong>Henüz ziyaret kaydı yok</strong><p>Gerçek ziyaretlerin oluştuğunda burada listelenecek.</p></div>';
    [elements.latestVisit, elements.compactVisitHistory, elements.memberHistoryPanel].forEach((container) => {
      if (!container) return;
      if (!visits.length) container.innerHTML = empty;
      else container.replaceChildren(...visits.map(renderVisit));
    });
  }

  function renderVisit(visit) {
    const item = document.createElement("article");
    item.className = "member-history-item";
    const date = document.createElement("strong");
    date.textContent = formatDate(visit.createdAt || visit.date);
    const detail = document.createElement("span");
    detail.textContent = String(visit.description || visit.branchName || "Tahmisçi ziyareti");
    item.append(date, detail);
    return item;
  }

  function renderAnnouncements() {
    if (!elements.memberAnnouncementFeed) return;
    if (!state.announcements.length) {
      elements.memberAnnouncementFeed.innerHTML = '<div class="member-empty member-empty--panel"><strong>Henüz duyuru yok</strong><p>Yeni Tahmisçi duyuruları burada görünecek.</p></div>';
      return;
    }
    const fragment = document.createDocumentFragment();
    state.announcements.forEach((announcement) => {
      const article = document.createElement("article");
      article.className = "announcement-card";
      const title = document.createElement("h3");
      title.textContent = announcement.title || "Duyuru";
      article.appendChild(title);
      (Array.isArray(announcement.blocks) ? announcement.blocks : []).forEach((block) => {
        if (block.badge) { const badge = document.createElement("small"); badge.textContent = block.badge; article.appendChild(badge); }
        if (block.heading) { const heading = document.createElement("h4"); heading.textContent = block.heading; article.appendChild(heading); }
        if (block.body) { const body = document.createElement("p"); body.textContent = block.body; article.appendChild(body); }
        if (block.imageUrl) {
          const image = document.createElement("img");
          image.src = block.imageUrl;
          image.alt = block.alt || announcement.title || "Duyuru görseli";
          image.loading = "lazy";
          article.appendChild(image);
        }
      });
      fragment.appendChild(article);
    });
    elements.memberAnnouncementFeed.replaceChildren(fragment);
  }

  function showMemberPanel(panel) {
    const target = ["welcome", "announcements", "history"].includes(panel) ? panel : "welcome";
    state.activePanel = target;
    document.querySelectorAll("[data-member-view]").forEach((view) => { view.hidden = view.dataset.memberView !== target; });
    document.querySelectorAll("[data-member-panel]").forEach((button) => button.setAttribute("aria-pressed", button.dataset.memberPanel === target ? "true" : "false"));
  }

  function openProfile() {
    if (!state.member || !elements.memberProfileOverlay) return;
    elements.memberProfileFullName.value = state.member.fullName || "";
    elements.memberProfileAlias.value = state.member.alias || "";
    elements.memberProfileBirthDate.value = state.member.birthDate || "";
    elements.memberProfileCampaignConsent.checked = state.member.campaignConsent === true;
    elements.memberProfileOverlay.hidden = false;
    elements.memberProfileTrigger?.setAttribute("aria-expanded", "true");
    document.body.classList.add("auth-open");
    window.TahmisciAccountSecurity?.refresh("mudavim");
    window.setTimeout(() => elements.memberProfileFullName?.focus(), 30);
  }

  function closeProfile() {
    if (!elements.memberProfileOverlay) return;
    elements.memberProfileOverlay.hidden = true;
    elements.memberProfileTrigger?.setAttribute("aria-expanded", "false");
    document.body.classList.remove("auth-open");
    setProfileMessage("");
  }

  async function saveProfile() {
    if (state.busy || !state.member) return;
    const body = {
      fullName: elements.memberProfileFullName?.value.trim() || "",
      alias: elements.memberProfileAlias?.value.trim() || "",
      birthDate: elements.memberProfileBirthDate?.value || "",
      campaignConsent: Boolean(elements.memberProfileCampaignConsent?.checked)
    };
    if (!body.fullName || !body.alias) return setProfileMessage("Ad soyad ve profil adı gerekli.", "error");
    state.busy = true;
    elements.memberProfileSave.disabled = true;
    setProfileMessage("Profil kaydediliyor…");
    try {
      const payload = await request("/api/mudavim/profile", { method: "PATCH", body });
      state.member = payload.member;
      renderMember();
      setProfileMessage(payload.message || "Profil güncellendi.", "success");
    } catch (error) {
      setProfileMessage(error.message || "Profil güncellenemedi.", "error");
    } finally {
      state.busy = false;
      elements.memberProfileSave.disabled = false;
    }
  }

  async function logout() {
    if (state.busy) return;
    state.busy = true;
    try { await request("/api/mudavim/logout", { method: "POST", body: {} }); } catch (_error) {}
    state.busy = false;
    closeProfile();
    renderGuest();
    document.dispatchEvent(new CustomEvent("mudavim:session-ended"));
  }

  function openAuth(step) {
    if (!elements.mudavimAuthOverlay) return;
    elements.mudavimAuthOverlay.hidden = false;
    document.body.classList.add("auth-open");
    showAuthStep(step || "login");
  }

  function closeAuth() {
    if (!elements.mudavimAuthOverlay) return;
    elements.mudavimAuthOverlay.hidden = true;
    document.body.classList.remove("auth-open");
    clearAuthMessages();
  }

  function showAuthStep(step) {
    const allowed = new Set(["login", "register", "verify-email", "forgot", "verify-reset", "new-password", "success"]);
    const target = allowed.has(step) ? step : "login";
    document.querySelectorAll("[data-auth-step]").forEach((card) => { card.hidden = card.dataset.authStep !== target; });
    clearAuthMessages();
    const first = document.querySelector(`[data-auth-step="${target}"] input:not([type="checkbox"])`);
    window.setTimeout(() => first?.focus(), 30);
  }

  function toggleFeature(button) {
    const selected = featureCopy[button.dataset.feature];
    if (!selected || !elements.featurePopover) return;
    const alreadyOpen = !elements.featurePopover.hidden && button.getAttribute("aria-expanded") === "true";
    closeFeature();
    if (alreadyOpen) return;
    elements.featurePopover.hidden = false;
    elements.featurePopover.querySelector("i").className = `fas ${selected[0]}`;
    setText(elements.featurePopoverTitle, selected[1]);
    setText(elements.featurePopoverText, selected[2]);
    button.setAttribute("aria-expanded", "true");
  }

  function closeFeature() {
    if (elements.featurePopover) elements.featurePopover.hidden = true;
    document.querySelectorAll("[data-feature]").forEach((button) => button.setAttribute("aria-expanded", "false"));
  }

  async function withBusy(form, operation) {
    state.busy = true;
    setAuthMessage(form, "İşlem yapılıyor…");
    form.querySelectorAll("button, input").forEach((control) => { control.disabled = true; });
    try { await operation(); }
    catch (error) { setAuthMessage(form, error.message || "İşlem tamamlanamadı.", "error"); }
    finally {
      state.busy = false;
      form.querySelectorAll("button, input").forEach((control) => { control.disabled = false; });
    }
  }

  async function request(path, options = {}) {
    const method = String(options.method || "GET").toUpperCase();
    const headers = { Accept: "application/json" };
    const init = { method, credentials: "include", cache: "no-store", headers };
    if (options.body !== undefined) { headers["Content-Type"] = "application/json"; init.body = JSON.stringify(options.body); }
    const response = await fetch(path, init);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok === false) {
      const error = new Error(payload.message || "İşlem tamamlanamadı.");
      error.status = response.status;
      error.code = payload.code || "";
      throw error;
    }
    return payload;
  }

  function setAuthMessage(form, message, tone) {
    const output = form && form.querySelector("[data-auth-message]");
    if (!output) return;
    output.textContent = message || "";
    output.hidden = !message;
    output.dataset.tone = tone || "";
  }

  function clearAuthMessages() {
    document.querySelectorAll("[data-auth-message]").forEach((output) => {
      output.textContent = "";
      output.hidden = true;
      delete output.dataset.tone;
    });
  }

  function setProfileMessage(message, tone) {
    if (!elements.memberProfileStatus) return;
    elements.memberProfileStatus.textContent = message || "";
    elements.memberProfileStatus.dataset.tone = tone || "";
  }

  function normalizeLoyalty(value) {
    const source = value && typeof value === "object" ? value : {};
    return {
      visitCount: Math.max(0, Number(source.visitCount || 0)),
      rewardTarget: Math.max(0, Number(source.rewardTarget || 0)),
      level: String(source.level || ""),
      recentVisits: Array.isArray(source.recentVisits) ? source.recentVisits : [],
      rewards: Array.isArray(source.rewards) ? source.rewards : [],
      available: source.available === true
    };
  }

  function emptyLoyalty() { return { visitCount: 0, rewardTarget: 0, level: "", recentVisits: [], rewards: [], available: false }; }
  function validEmail(value) { return String(value || "").length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "")); }
  function value(id) { return String(document.getElementById(id)?.value || "").trim(); }
  function focus(id) { window.setTimeout(() => document.getElementById(id)?.focus(), 30); }
  function setText(element, value) { if (element) element.textContent = String(value == null ? "" : value); }
  function formatDate(value) {
    const date = new Date(value || "");
    return Number.isFinite(date.getTime())
      ? new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Istanbul" }).format(date)
      : "Tarih bilgisi yok";
  }
})();
