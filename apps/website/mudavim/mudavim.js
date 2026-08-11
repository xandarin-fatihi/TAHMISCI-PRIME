(function () {
  "use strict";

  const MEMBER_SESSION_KEY = "tahmisci.mudavim.session.v1";
  const MEMBER_SESSION_SCHEMA = 1;

  const memberState = {
    code: "THM-4821",
    level: "Gold",
    visitCount: 6,
    rewardTarget: 10,
    profile: {
      firstName: "",
      lastName: "",
      fullName: "",
      alias: "",
      phone: "",
      birthDate: "",
      email: "",
      photoUrl: "",
      announcementsEnabled: true,
      birthdayEnabled: true
    },
    recentVisits: [
      { date: "2026-07-12", branch: "Tahmisçi Torbalı", detail: "Ziyaret kaydı" },
      { date: "2026-07-06", branch: "Tahmisçi Torbalı", detail: "Ziyaret kaydı" },
      { date: "2026-06-28", branch: "Tahmisçi Torbalı", detail: "Ziyaret kaydı" },
      { date: "2026-06-19", branch: "Tahmisçi Torbalı", detail: "Ziyaret kaydı" },
      { date: "2026-06-11", branch: "Tahmisçi Torbalı", detail: "Ziyaret kaydı" }
    ]
  };

  const memberTiers = [
    { name: "Bronz", threshold: 0 },
    { name: "Silver", threshold: 10 },
    { name: "Gold", threshold: 25 },
    { name: "Platin", threshold: 50 }
  ];

  const featureDetails = {
    qr: {
      title: "Dijital QR kart",
      icon: "fa-qrcode",
      text: "Kasada okutulan dijital kartınla ziyaretlerin otomatik işlenir. Kartını telefonundan hızlıca gösterip ilerlemeni takip edebilirsin."
    },
    visits: {
      title: "Ziyaret takibi",
      icon: "fa-clock-rotate-left",
      text: "Her ziyaretin sistemde kaydolur. İlerlemeni tek ekranda takip edebilir, geçmiş etkileşimlerini daha düzenli görebilirsin."
    },
    mobile: {
      title: "Mobil arayüz",
      icon: "fa-mobile-screen-button",
      text: "Müdavim deneyimi telefonda rahat kullanım için tasarlandı. Kartına, bilgilerine ve ilerleme durumuna hızlıca ulaşabilirsin."
    },
    profile: {
      title: "Profil yönetimi",
      icon: "fa-user",
      text: "Hesap bilgilerini tek yerden düzenleyebilir ve kişisel alanını daha rahat yönetebilirsin."
    }
  };

  const auth = {
    isAuthenticated: false,
    registrationPhone: "",
    lastFocus: null
  };

  const overlay = document.getElementById("mudavimAuthOverlay");
  const closeButton = overlay?.querySelector(".mudavim-auth-close");
  const steps = overlay ? Array.from(overlay.querySelectorAll("[data-auth-step]")) : [];
  const gate = document.getElementById("gate");
  const app = document.getElementById("app");
  const featureLayout = document.querySelector(".gate-feature-layout");
  const featureButtons = Array.from(document.querySelectorAll("[data-feature]"));
  const featurePopover = document.getElementById("featurePopover");
  const memberPanelButtons = Array.from(document.querySelectorAll("[data-member-panel]"));
  const memberViews = Array.from(document.querySelectorAll("[data-member-view]"));
  const profileOverlay = document.getElementById("memberProfileOverlay");
  const profileTrigger = document.getElementById("memberProfileTrigger");
  const profileForm = document.getElementById("memberProfileForm");
  const profilePhotoInput = document.getElementById("memberProfilePhoto");
  let activeFeatureButton = null;
  let activeMemberPanel = "welcome";
  let announcements = [];
  let announcementLoadFailed = false;
  let announcementEventSource = null;
  let profileLastFocus = null;
  let profileDraftPhotoUrl = "";
  let memberLoginAt = "";

  featureButtons.forEach((button) => {
    button.addEventListener("click", () => toggleFeature(button));
  });

  memberPanelButtons.forEach((button) => {
    button.addEventListener("click", () => toggleMemberPanel(button.dataset.memberPanel));
  });

  document.querySelectorAll("[data-member-panel-close]").forEach((button) => {
    button.addEventListener("click", () => closeMemberPanel(true));
  });

  profileTrigger?.addEventListener("click", openProfileModal);

  document.querySelectorAll("[data-profile-close]").forEach((button) => {
    button.addEventListener("click", () => closeProfileModal(true));
  });

  profileOverlay?.addEventListener("click", (event) => {
    if (event.target === profileOverlay) closeProfileModal(true);
  });

  profileForm?.addEventListener("submit", saveProfile);
  profilePhotoInput?.addEventListener("change", handleProfilePhoto);
  ["memberProfileFirstName", "memberProfileLastName"].forEach((id) => {
    document.getElementById(id)?.addEventListener("input", () => renderProfilePhoto(profileDraftPhotoUrl));
  });

  document.addEventListener("click", (event) => {
    if (!featurePopover?.hidden && featureLayout && !featureLayout.contains(event.target)) {
      closeFeaturePopover();
    }
  });

  document.querySelectorAll("[data-auth-open]").forEach((trigger) => {
    if (trigger.closest("#mudavimAuthOverlay")) return;
    trigger.addEventListener("click", () => {
      const target = trigger.dataset.authOpen || "login";
      if (target === "google") {
        completeAuth("existing");
        openAuth("success", trigger);
        return;
      }
      openAuth(target, trigger);
    });
  });

  document.querySelectorAll("[data-logout]").forEach((button) => {
    button.addEventListener("click", () => setAuthenticated(false));
  });

  overlay?.addEventListener("click", (event) => {
    if (event.target === overlay) closeAuth();
  });

  closeButton?.addEventListener("click", closeAuth);

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (profileOverlay && !profileOverlay.hidden) {
      closeProfileModal(true);
      return;
    }
    if (featurePopover && !featurePopover.hidden) closeFeaturePopover(true);
    if (overlay && !overlay.hidden) closeAuth();
    if (auth.isAuthenticated && activeMemberPanel !== "welcome") closeMemberPanel(true);
  });

  window.addEventListener("beforeunload", () => {
    if (auth.isAuthenticated) persistMemberSession();
    announcementEventSource?.close();
  });

  window.addEventListener("storage", (event) => {
    if (event.key === MEMBER_SESSION_KEY && !event.newValue && auth.isAuthenticated) {
      setAuthenticated(false);
    }
  });

  overlay?.querySelectorAll("[data-auth-open]").forEach((button) => {
    button.addEventListener("click", () => {
      const target = button.dataset.authOpen || "login";
      if (target === "google") {
        completeAuth("existing");
        showAuthStep("success");
        return;
      }
      showAuthStep(target);
    });
  });

  overlay?.querySelector("[data-auth-resend]")?.addEventListener("click", (event) => {
    event.currentTarget.textContent = "Kod tekrar gönderildi";
    window.setTimeout(() => {
      event.currentTarget.textContent = "Kodu tekrar gönder";
    }, 1400);
  });

  overlay?.querySelector("[data-auth-step='login']")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const phone = readValue("loginPhone");
    const password = readValue("loginPassword");
    if (!phone || !password) return focusFirstEmpty(["loginPhone", "loginPassword"]);
    memberState.visitCount = 6;
    memberState.level = "Gold";
    memberState.profile.phone = phone;
    completeAuth("existing");
  });

  overlay?.querySelector("[data-auth-step='register-phone']")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const phone = readValue("registerPhone");
    if (!phone) return focusById("registerPhone");
    auth.registrationPhone = phone;
    clearOtp("register");
    showAuthStep("register-otp");
  });

  overlay?.querySelector("[data-auth-step='register-otp']")?.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!isOtpComplete("register")) return focusFirstOtp("register");
    showAuthStep("register-password");
  });

  overlay?.querySelector("[data-auth-step='register-password']")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const password = readValue("registerPassword");
    const confirm = readValue("registerPasswordConfirm");
    const error = document.getElementById("passwordError");
    const valid = password.length >= 6 && password === confirm;
    if (error) error.hidden = valid;
    if (!valid) return focusById(password.length < 6 ? "registerPassword" : "registerPasswordConfirm");
    showAuthStep("register-profile");
  });

  overlay?.querySelector("[data-auth-step='register-profile']")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const terms = document.getElementById("registerTerms");
    const required = ["registerName", "registerAlias", "registerBirthDate"];
    if (!required.every(readValue)) return focusFirstEmpty(required);
    if (terms && !terms.checked) {
      terms.focus();
      return;
    }
    memberState.profile = {
      firstName: "",
      lastName: "",
      fullName: readValue("registerName"),
      alias: readValue("registerAlias"),
      phone: auth.registrationPhone,
      birthDate: readValue("registerBirthDate"),
      email: readValue("registerEmail"),
      photoUrl: "",
      announcementsEnabled: true,
      birthdayEnabled: true
    };
    completeAuth("new");
  });

  overlay?.querySelector("[data-auth-step='phone']")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const phone = readValue("mudavimPhone");
    if (!phone) return focusById("mudavimPhone");
    memberState.profile.phone = phone;
    clearOtp("login");
    showAuthStep("otp");
  });

  overlay?.querySelector("[data-auth-step='otp']")?.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!isOtpComplete("login")) return focusFirstOtp("login");
    memberState.visitCount = 6;
    memberState.level = "Gold";
    completeAuth("existing");
  });

  overlay?.querySelector("[data-auth-finish]")?.addEventListener("click", () => {
    closeAuth();
    setAuthenticated(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  initOtpInputs();

  function toggleFeature(button) {
    if (activeFeatureButton === button && featurePopover && !featurePopover.hidden) {
      closeFeaturePopover(true);
      return;
    }
    openFeaturePopover(button);
  }

  function openFeaturePopover(button) {
    if (!button || !featurePopover) return;
    const detail = featureDetails[button.dataset.feature];
    if (!detail) return;
    featureButtons.forEach((item) => item.setAttribute("aria-expanded", String(item === button)));
    setText("featurePopoverTitle", detail.title);
    setText("featurePopoverText", detail.text);
    const icon = featurePopover.querySelector(".feature-popover__icon i");
    if (icon) icon.className = `fas ${detail.icon}`;
    featurePopover.hidden = false;
    activeFeatureButton = button;
  }

  function closeFeaturePopover(restoreFocus = false) {
    if (!featurePopover) return;
    const previousButton = activeFeatureButton;
    featurePopover.hidden = true;
    featureButtons.forEach((item) => item.setAttribute("aria-expanded", "false"));
    activeFeatureButton = null;
    if (restoreFocus) previousButton?.focus();
  }

  function toggleMemberPanel(panelName) {
    const safeName = ["announcements", "history"].includes(panelName) ? panelName : "welcome";
    if (activeMemberPanel === safeName) {
      closeMemberPanel(true);
      return;
    }
    showMemberPanel(safeName);
  }

  function showMemberPanel(panelName) {
    const safeName = ["announcements", "history"].includes(panelName) ? panelName : "welcome";
    activeMemberPanel = safeName;
    memberViews.forEach((view) => {
      view.hidden = view.dataset.memberView !== safeName;
    });
    memberPanelButtons.forEach((button) => {
      const selected = button.dataset.memberPanel === safeName;
      button.classList.toggle("is-active", selected);
      button.setAttribute("aria-pressed", String(selected));
    });
    if (safeName === "announcements") renderAnnouncements();
  }

  function closeMemberPanel(restoreFocus = false) {
    const previousPanel = activeMemberPanel;
    showMemberPanel("welcome");
    if (restoreFocus && previousPanel !== "welcome") {
      document.querySelector(`.member-tabs [data-member-panel='${previousPanel}']`)?.focus();
    }
  }

  function openProfileModal() {
    if (!profileOverlay || !auth.isAuthenticated) return;
    profileLastFocus = document.activeElement;
    populateProfileForm();
    profileOverlay.hidden = false;
    profileTrigger?.setAttribute("aria-expanded", "true");
    document.documentElement.classList.add("profile-open");
    document.body.classList.add("profile-open");
    window.setTimeout(() => document.getElementById("memberProfileFirstName")?.focus(), 30);
  }

  function closeProfileModal(restoreFocus = false) {
    if (!profileOverlay || profileOverlay.hidden) return;
    if (profileDraftPhotoUrl && profileDraftPhotoUrl !== memberState.profile.photoUrl) {
      URL.revokeObjectURL(profileDraftPhotoUrl);
    }
    profileDraftPhotoUrl = "";
    profileOverlay.hidden = true;
    profileTrigger?.setAttribute("aria-expanded", "false");
    document.documentElement.classList.remove("profile-open");
    document.body.classList.remove("profile-open");
    setText("memberProfileStatus", "");
    if (profilePhotoInput) profilePhotoInput.value = "";
    if (restoreFocus) (profileLastFocus || profileTrigger)?.focus?.();
  }

  function populateProfileForm() {
    const profile = memberState.profile;
    const nameParts = splitProfileName(profile.fullName);
    setInputValue("memberProfileFirstName", profile.firstName || nameParts.firstName);
    setInputValue("memberProfileLastName", profile.lastName || nameParts.lastName);
    setInputValue("memberProfileBirthDate", profile.birthDate);
    setInputValue("memberProfilePhone", profile.phone);
    setInputValue("memberProfileEmail", profile.email);
    setChecked("memberProfileAnnouncements", profile.announcementsEnabled !== false);
    setChecked("memberProfileBirthday", profile.birthdayEnabled !== false);
    profileDraftPhotoUrl = profile.photoUrl || "";
    renderProfilePhoto(profileDraftPhotoUrl);
    setText("memberProfileStatus", "");
  }

  function saveProfile(event) {
    event.preventDefault();
    if (!profileForm?.reportValidity()) return;
    const firstName = readValue("memberProfileFirstName");
    const lastName = readValue("memberProfileLastName");
    const previousPhotoUrl = memberState.profile.photoUrl;
    memberState.profile = {
      ...memberState.profile,
      firstName,
      lastName,
      fullName: [firstName, lastName].filter(Boolean).join(" "),
      birthDate: readValue("memberProfileBirthDate"),
      phone: readValue("memberProfilePhone"),
      email: readValue("memberProfileEmail"),
      photoUrl: profileDraftPhotoUrl,
      announcementsEnabled: Boolean(document.getElementById("memberProfileAnnouncements")?.checked),
      birthdayEnabled: Boolean(document.getElementById("memberProfileBirthday")?.checked)
    };
    if (previousPhotoUrl?.startsWith("blob:") && previousPhotoUrl !== profileDraftPhotoUrl) {
      URL.revokeObjectURL(previousPhotoUrl);
    }
    renderDashboard();
    persistMemberSession();
    setText("memberProfileStatus", "Profil bilgileri güncellendi.");
    window.setTimeout(() => closeProfileModal(true), 220);
  }

  function handleProfilePhoto(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const acceptedTypes = ["image/jpeg", "image/png"];
    if (!acceptedTypes.includes(file.type) || file.size > 5 * 1024 * 1024) {
      event.target.value = "";
      setText("memberProfileStatus", "Yalnızca 5 MB altındaki JPG veya PNG dosyaları kullanılabilir.");
      return;
    }
    if (profileDraftPhotoUrl?.startsWith("blob:") && profileDraftPhotoUrl !== memberState.profile.photoUrl) {
      URL.revokeObjectURL(profileDraftPhotoUrl);
    }
    profileDraftPhotoUrl = URL.createObjectURL(file);
    renderProfilePhoto(profileDraftPhotoUrl);
    setText("memberProfileStatus", "Fotoğraf kaydetmeye hazır.");
  }

  function renderProfilePhoto(photoUrl) {
    const preview = document.getElementById("memberProfilePhotoPreview");
    const initialsTarget = document.getElementById("memberProfilePhotoInitials");
    const draftName = [readValue("memberProfileFirstName"), readValue("memberProfileLastName")].filter(Boolean).join(" ");
    if (preview) {
      preview.hidden = !photoUrl;
      preview.src = photoUrl || "";
    }
    if (initialsTarget) {
      initialsTarget.hidden = Boolean(photoUrl);
      initialsTarget.textContent = initials(draftName || memberState.profile.alias || "Müdavim");
    }
  }

  function splitProfileName(value) {
    const parts = String(value || "").trim().split(/\s+/).filter(Boolean);
    if (parts.length < 2) return { firstName: parts[0] || "", lastName: "" };
    return { firstName: parts.slice(0, -1).join(" "), lastName: parts.at(-1) };
  }

  function restoreMemberSession() {
    try {
      const raw = window.localStorage.getItem(MEMBER_SESSION_KEY);
      if (!raw) return false;
      const session = JSON.parse(raw);
      if (!session || session.schemaVersion !== MEMBER_SESSION_SCHEMA || session.isLoggedIn !== true) {
        clearMemberSession();
        return false;
      }
      const displayName = sanitizeSessionText(session.displayName, 120);
      memberState.profile.fullName = displayName;
      memberState.profile.firstName = "";
      memberState.profile.lastName = "";
      memberState.profile.photoUrl = persistentAvatarUrl(session.avatarUrl);
      memberLoginAt = validIsoDate(session.loginAt) ? session.loginAt : new Date().toISOString();
      return true;
    } catch (error) {
      clearMemberSession();
      return false;
    }
  }

  function persistMemberSession() {
    if (!auth.isAuthenticated) return;
    try {
      const now = new Date().toISOString();
      memberLoginAt = validIsoDate(memberLoginAt) ? memberLoginAt : now;
      const payload = {
        schemaVersion: MEMBER_SESSION_SCHEMA,
        isLoggedIn: true,
        displayName: sanitizeSessionText(memberState.profile.fullName || memberState.profile.alias, 120),
        phoneMasked: maskPhone(memberState.profile.phone),
        avatarUrl: persistentAvatarUrl(memberState.profile.photoUrl),
        loginAt: memberLoginAt,
        lastSeenAt: now
      };
      window.localStorage.setItem(MEMBER_SESSION_KEY, JSON.stringify(payload));
    } catch (error) {
      // Depolama kapalıysa mevcut sekmedeki oturum çalışmaya devam eder.
    }
  }

  function clearMemberSession() {
    memberLoginAt = "";
    try {
      window.localStorage.removeItem(MEMBER_SESSION_KEY);
    } catch (error) {
      // Depolama kapalıysa temizlenecek kalıcı bir kayıt yoktur.
    }
  }

  function sanitizeSessionText(value, maxLength) {
    return String(value || "").replace(/[\u0000-\u001F\u007F]/g, "").trim().slice(0, maxLength);
  }

  function maskPhone(value) {
    const digits = String(value || "").replace(/\D/g, "");
    if (digits.length < 4) return "";
    return `${digits.slice(0, 2)}•••••••${digits.slice(-2)}`;
  }

  function persistentAvatarUrl(value) {
    const source = String(value || "").trim();
    if (!source || source.startsWith("blob:") || source.startsWith("data:")) return "";
    try {
      const url = new URL(source, window.location.origin);
      return url.origin === window.location.origin && ["http:", "https:"].includes(url.protocol)
        ? `${url.pathname}${url.search}${url.hash}`
        : "";
    } catch (error) {
      return "";
    }
  }

  function validIsoDate(value) {
    return typeof value === "string" && !Number.isNaN(Date.parse(value));
  }

  async function loadAnnouncements() {
    try {
      const response = await fetch("/api/public/bootstrap", { headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      applyAnnouncementPayload(await response.json());
      announcementLoadFailed = false;
    } catch (error) {
      announcementLoadFailed = true;
      console.error("Müdavim duyuruları alınamadı:", error);
      renderAnnouncements();
    }
    connectAnnouncementEvents();
  }

  function connectAnnouncementEvents() {
    if (!window.EventSource || announcementEventSource) return;
    announcementEventSource = new EventSource("/api/public/events");
    announcementEventSource.addEventListener("bootstrap", (event) => {
      try {
        applyAnnouncementPayload(JSON.parse(event.data || "{}"));
        announcementLoadFailed = false;
      } catch (error) {
        console.error("Canlı Müdavim duyurusu okunamadı:", error);
      }
    });
  }

  function applyAnnouncementPayload(payload) {
    announcements = normalizeAnnouncements(payload?.siteState?.mudavim?.announcements);
    renderAnnouncements();
  }

  function normalizeAnnouncements(value) {
    return (Array.isArray(value) ? value : [])
      .filter((item) => item && item.isPublished !== false)
      .map((item, itemIndex) => ({
        id: String(item.id || `announcement-${itemIndex + 1}`),
        title: String(item.title || "Duyuru"),
        order: Number.isFinite(Number(item.order)) ? Number(item.order) : itemIndex,
        blocks: (Array.isArray(item.blocks) ? item.blocks : []).map((block, blockIndex) => {
          const allowedTypes = ["text", "image", "image-text", "text-image"];
          const type = allowedTypes.includes(block?.type) ? block.type : (block?.type === "image" ? "image" : "text");
          const hasText = type !== "image";
          const hasImage = type !== "text";
          return {
            id: String(block?.id || `block-${blockIndex + 1}`),
            type,
            badge: hasText ? String(block?.badge || "") : "",
            date: hasText ? String(block?.date || "") : "",
            heading: hasText ? String(block?.heading || "") : "",
            body: hasText ? String(block?.body ?? block?.content ?? "") : "",
            imageUrl: hasImage ? String(block?.imageUrl || "") : "",
            alt: hasImage ? String(block?.alt || "") : "",
            order: Number.isFinite(Number(block?.order)) ? Number(block.order) : blockIndex
          };
        }).filter((block) => {
          const hasText = Boolean(block.badge.trim() || block.date.trim() || block.heading.trim() || block.body.trim());
          const hasImage = Boolean(block.imageUrl.trim());
          return block.type === "text" ? hasText : block.type === "image" ? hasImage : hasText || hasImage;
        })
          .sort((first, second) => first.order - second.order)
      }))
      .sort((first, second) => first.order - second.order);
  }

  function openAuth(step, trigger) {
    if (!overlay) return;
    auth.lastFocus = trigger || document.activeElement;
    overlay.hidden = false;
    document.body.classList.add("auth-open");
    showAuthStep(step || "login");
  }

  function closeAuth() {
    if (!overlay) return;
    overlay.hidden = true;
    document.body.classList.remove("auth-open");
    auth.lastFocus?.focus?.();
  }

  function showAuthStep(stepName) {
    const safeStep = steps.some((step) => step.dataset.authStep === stepName) ? stepName : "login";
    steps.forEach((step) => {
      step.hidden = step.dataset.authStep !== safeStep;
    });
    window.setTimeout(() => {
      const activeStep = steps.find((step) => step.dataset.authStep === safeStep);
      const focusTarget = activeStep?.querySelector("input:not([type='checkbox']), button:not(.mudavim-auth-close)");
      focusTarget?.focus?.();
    }, 30);
  }

  function completeAuth(kind) {
    if (kind === "new") {
      memberState.visitCount = 0;
      memberState.level = "Gold";
    }
    const progressText = `${memberState.visitCount} / ${memberState.rewardTarget} ziyaret`;
    setText("authSuccessCode", memberState.code);
    setText("authSuccessProgress", progressText);
    renderDashboard();
    showAuthStep("success");
  }

  function setAuthenticated(value) {
    auth.isAuthenticated = Boolean(value);
    if (auth.isAuthenticated) persistMemberSession();
    else clearMemberSession();
    document.body.classList.toggle("is-member", auth.isAuthenticated);
    document.body.classList.toggle("is-guest", !auth.isAuthenticated);
    if (gate) gate.hidden = auth.isAuthenticated;
    if (app) app.hidden = !auth.isAuthenticated;
    document.querySelectorAll("[data-guest-nav]").forEach((item) => {
      item.hidden = auth.isAuthenticated;
    });
    document.querySelectorAll("[data-member-nav]").forEach((item) => {
      item.hidden = !auth.isAuthenticated;
    });
    renderDashboard();
    closeMemberPanel();
    if (!auth.isAuthenticated) closeProfileModal();
    if (!auth.isAuthenticated) {
      document.getElementById("gate")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  function renderDashboard() {
    const remaining = Math.max(0, memberState.rewardTarget - memberState.visitCount);
    const remainingText = remaining === 0 ? "Ödülün hazır." : `Bir sonraki ödüle ${remaining} ziyaret kaldı.`;
    const fullName = memberState.profile.fullName || memberState.profile.alias || "Müdavim";

    setText("progressCount", String(memberState.visitCount));
    setText("rewardTarget", String(memberState.rewardTarget));
    setText("progressText", remainingText);
    setText("memberLevel", memberState.level);
    setText("centerMemberLevel", memberState.level);
    setText("centerVisitCount", String(memberState.visitCount));
    setText("centerRemaining", remaining === 0 ? "Ödül hazır" : `${remaining} ziyaret`);
    setText("memberFullName", fullName);
    setText("memberWelcomeName", fullName);

    const avatar = document.getElementById("memberAvatar");
    if (avatar) {
      avatar.textContent = memberState.profile.photoUrl ? "" : initials(fullName);
      avatar.style.backgroundImage = memberState.profile.photoUrl
        ? `url("${memberState.profile.photoUrl.replace(/["\\]/g, "")}")`
        : "";
      avatar.style.backgroundSize = "cover";
      avatar.style.backgroundPosition = "center";
    }

    const segments = document.getElementById("visitSegments");
    if (segments) {
      segments.innerHTML = Array.from({ length: memberState.rewardTarget }, (_, index) => (
        `<span class="${index < memberState.visitCount ? "is-filled" : ""}" aria-hidden="true"></span>`
      )).join("");
    }

    const tierTrack = document.getElementById("tierTrack");
    if (tierTrack) {
      const activeIndex = Math.max(0, memberTiers.findIndex((tier) => tier.name === memberState.level));
      tierTrack.style.setProperty("--tier-progress", `${(activeIndex / Math.max(1, memberTiers.length - 1)) * 100}%`);
      tierTrack.innerHTML = memberTiers.map((tier, index) => `
        <span class="tier-step${index < activeIndex ? " is-complete" : ""}${index === activeIndex ? " is-current" : ""}">
          <i aria-hidden="true">${index < activeIndex ? "✓" : index === activeIndex ? "★" : ""}</i>
          <strong>${escapeHTML(tier.name)}</strong>
          <small>${tier.threshold} ziyaret</small>
        </span>
      `).join("");
    }

    renderLatestVisit();
    renderVisitHistory("compactVisitHistory", memberState.recentVisits.slice(0, 4), true);
    renderVisitHistory("memberHistoryPanel", memberState.recentVisits, false);
    renderAnnouncements();
  }

  function renderLatestVisit() {
    const target = document.getElementById("latestVisit");
    if (!target) return;
    const visit = memberState.recentVisits[0];
    target.innerHTML = visit ? `
      <div class="latest-visit-row"><i class="far fa-calendar" aria-hidden="true"></i><strong>${escapeHTML(formatVisitDate(visit.date))}</strong></div>
      <div class="latest-visit-row"><i class="fas fa-store" aria-hidden="true"></i><span>${escapeHTML(visit.branch)}</span></div>
    ` : `<p class="member-empty">Henüz ziyaret kaydı yok.</p>`;
  }

  function renderVisitHistory(targetId, visits, compact) {
    const target = document.getElementById(targetId);
    if (!target) return;
    target.innerHTML = visits.length ? visits.map((visit) => `
      <article class="member-history-row">
        <time datetime="${escapeHTML(visit.date)}">${escapeHTML(formatVisitDate(visit.date))}</time>
        <span><strong>${escapeHTML(visit.branch)}</strong>${compact ? "" : `<small>${escapeHTML(visit.detail || "Ziyaret kaydı")}</small>`}</span>
        <i class="fas fa-chevron-right" aria-hidden="true"></i>
      </article>
    `).join("") : `<p class="member-empty">Henüz ziyaret kaydı yok.</p>`;
  }

  function renderAnnouncements() {
    const target = document.getElementById("memberAnnouncementFeed");
    if (!target) return;
    if (!announcements.length) {
      target.innerHTML = `<div class="member-empty member-empty--panel"><i class="far fa-bell" aria-hidden="true"></i><strong>${announcementLoadFailed ? "Duyurular alınamadı" : "Henüz yayınlanmış duyuru yok"}</strong><span>${announcementLoadFailed ? "Bağlantıyı kontrol edip yeniden deneyebilirsin." : "Yeni duyurular yayınlandığında burada görünecek."}</span></div>`;
      return;
    }
    target.innerHTML = announcements.map((announcement) => `
      <article class="announcement-item">
        <header><span>Duyuru</span><h3>${escapeHTML(announcement.title)}</h3></header>
        <div class="announcement-blocks">
          ${announcement.blocks.map((block) => renderAnnouncementBlock(block, announcement.title)).join("")}
        </div>
      </article>
    `).join("");
    applyAnnouncementImageOrientation(target);
  }

  function renderAnnouncementBlock(block, announcementTitle) {
    const hasText = block.type !== "image";
    const hasImage = block.type !== "text";
    const hasCopy = hasText && Boolean(block.badge || block.date || block.heading || block.body);
    const hasMedia = hasImage && Boolean(block.imageUrl);
    const displayType = hasCopy && hasMedia ? block.type : hasMedia ? "image" : "text";
    const meta = hasCopy && (block.badge || block.date) ? `
      <div class="announcement-block-meta">
        ${block.badge ? `<span>${escapeHTML(block.badge)}</span>` : ""}
        ${block.date ? `<time datetime="${escapeHTML(block.date)}">${escapeHTML(formatAnnouncementDate(block.date))}</time>` : ""}
      </div>
    ` : "";
    const copy = hasCopy ? `
      <div class="announcement-block-copy">
        ${meta}
        ${block.heading ? `<h4>${escapeHTML(block.heading)}</h4>` : ""}
        ${block.body ? `<p>${escapeHTML(block.body).replace(/\n/g, "<br>")}</p>` : ""}
      </div>
    ` : "";
    const media = hasMedia ? `
      <figure class="announcement-block-media">
        <img src="${escapeHTML(block.imageUrl)}" alt="${escapeHTML(block.alt || block.heading || announcementTitle)}" loading="lazy">
      </figure>
    ` : "";
    return `<section class="announcement-layout-block is-${escapeHTML(displayType)}">${media}${copy}</section>`;
  }

  function formatAnnouncementDate(value) {
    if (!value) return "";
    const date = new Date(`${value}T12:00:00`);
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString("tr-TR", { day: "numeric", month: "long", year: "numeric" });
  }

  function applyAnnouncementImageOrientation(root) {
    root.querySelectorAll(".announcement-block-media img").forEach((image) => {
      const apply = () => {
        const frame = image.closest(".announcement-block-media");
        if (!frame) return;
        frame.classList.toggle("is-portrait", image.naturalHeight > image.naturalWidth);
        frame.classList.toggle("is-landscape", image.naturalHeight <= image.naturalWidth);
      };
      if (image.complete) apply();
      else image.addEventListener("load", apply, { once: true });
    });
  }

  function initOtpInputs() {
    if (!overlay) return;
    overlay.querySelectorAll(".mudavim-otp").forEach((group) => {
      const inputs = Array.from(group.querySelectorAll("input"));
      inputs.forEach((input, index) => {
        input.addEventListener("input", () => {
          input.value = input.value.replace(/\D/g, "").slice(0, 1);
          if (input.value && inputs[index + 1]) inputs[index + 1].focus();
        });
        input.addEventListener("keydown", (event) => {
          if (event.key === "Backspace" && !input.value && inputs[index - 1]) {
            inputs[index - 1].focus();
          }
        });
        input.addEventListener("paste", (event) => {
          const text = event.clipboardData?.getData("text")?.replace(/\D/g, "").slice(0, inputs.length);
          if (!text) return;
          event.preventDefault();
          inputs.forEach((field, fieldIndex) => {
            field.value = text[fieldIndex] || "";
          });
          inputs[Math.min(text.length, inputs.length) - 1]?.focus();
        });
      });
    });
  }

  function otpInputs(groupName) {
    return Array.from(overlay?.querySelectorAll(`[data-otp-group='${groupName}'] input`) || []);
  }

  function clearOtp(groupName) {
    otpInputs(groupName).forEach((input) => {
      input.value = "";
    });
  }

  function isOtpComplete(groupName) {
    return otpInputs(groupName).map((input) => input.value).join("").length === 6;
  }

  function focusFirstOtp(groupName) {
    const target = otpInputs(groupName).find((input) => !input.value) || otpInputs(groupName)[0];
    target?.focus();
  }

  function focusFirstEmpty(ids) {
    const targetId = ids.find((id) => !readValue(id));
    if (targetId) focusById(targetId);
  }

  function focusById(id) {
    document.getElementById(id)?.focus();
  }

  function readValue(id) {
    return document.getElementById(id)?.value.trim() || "";
  }

  function formatVisitDate(value) {
    if (!value) return "-";
    const date = new Date(`${value}T12:00:00`);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleDateString("tr-TR", { day: "numeric", month: "long", year: "numeric" });
  }

  function initials(value) {
    const words = String(value || "").trim().split(/\s+/).filter(Boolean);
    return words.slice(0, 2).map((word) => word[0]).join("").toLocaleUpperCase("tr-TR") || "TM";
  }

  function setText(id, value) {
    const target = document.getElementById(id);
    if (target) target.textContent = value;
  }

  function setInputValue(id, value) {
    const target = document.getElementById(id);
    if (target) target.value = String(value || "");
  }

  function setChecked(id, value) {
    const target = document.getElementById(id);
    if (target) target.checked = Boolean(value);
  }

  function escapeHTML(value) {
    return String(value || "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    }[char]));
  }

  const hasStoredSession = restoreMemberSession();
  renderDashboard();
  setAuthenticated(hasStoredSession);
  loadAnnouncements();
})();
