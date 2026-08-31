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
    activePanel: "welcome",
    legalVersions: { membershipTerms: "", privacyNotice: "", commercialConsent: "" },
    activeLegal: "",
    legalTarget: null,
    legalReturnFocus: null,
    resendTimer: 0,
    resendInterval: 0,
    notifications: [],
    notificationPreferences: null,
    notificationCapabilities: null,
    notificationEvents: null,
    infoReturnFocus: null,
    activeInfoItem: ""
  };
  const elements = {};
  const INFO_ITEM_DEFINITIONS = Object.freeze([
    Object.freeze({
      id: "account",
      title: "Güvenli hesap",
      eyebrow: "HESAP GÜVENLİĞİ",
      icon: "shield",
      landing: true,
      description: "Müdavim hesabın e-posta doğrulaması ve güvenli oturum sistemiyle korunur. Şifreni unuttuğunda doğrulanmış e-posta adresin üzerinden hesabını kurtarabilirsin.",
      details: ["E-posta doğrulama", "Güvenli oturum", "Şifre sıfırlama", "Hesap kontrolü"]
    }),
    Object.freeze({
      id: "app",
      title: "Tahmisçi Müdavim uygulaması",
      eyebrow: "MOBİL UYGULAMA",
      icon: "phone",
      landing: true,
      description: "Tahmisçi Müdavim’i telefonuna ekleyerek tarayıcıdan bağımsız bir uygulama gibi kullan. Hesabına tek dokunuşla ulaş.",
      details: ["Ana ekrana ekleme", "Standalone uygulama deneyimi", "Hızlı erişim", "Güncel sürüm desteği"],
      action: "install"
    }),
    Object.freeze({
      id: "notifications",
      title: "Bildirimler ve duyurular",
      eyebrow: "BİLDİRİMLER",
      icon: "bell",
      landing: true,
      description: "Tahmisçi duyurularını, hesap bildirimlerini ve izin verdiğin kampanyaları Müdavim üzerinden takip et.",
      details: ["Hesap bildirimleri", "Müdavim duyuruları", "Uygulama bildirimleri", "Kampanya tercihleri"],
      action: "notifications"
    }),
    Object.freeze({
      id: "profile",
      title: "Profil ve tercihler",
      eyebrow: "HESABIN",
      icon: "profile",
      landing: true,
      description: "Müdavim profilini ve iletişim tercihlerini tek yerden yönet.",
      details: ["Profil bilgileri", "Doğum tarihi", "Kampanya tercihi", "Bildirim tercihleri"]
    }),
    Object.freeze({
      id: "campaigns",
      title: "Kampanyalar",
      eyebrow: "TAHMİSÇİ DUYURULARI",
      icon: "tag",
      landing: true,
      description: "Tahmisçi’nin aktif Müdavim kampanyalarını ve duyurularını tek yerden incele.",
      details: ["Aktif kampanyalar", "Müdavim duyuruları", "Kampanya tercihleri"]
    }),
    Object.freeze({
      id: "about",
      title: "Tahmisçi Hakkında",
      eyebrow: "HAKKIMIZDA",
      icon: "coffee",
      landing: false,
      description: "Kurtuluş Savaşı'nın ardından büyük dedem Hüseyin Tünaydın, 1926'da Torbalı'da kahve çekirdeklerini zeytin odununda kavurup taş dibekte döverek satmaya başladı. Kahvesinin kokusu kısa sürede köyleri sardı ve herkes “Tahmisçi Hüseyin Efendi”nin kahvesini içmeden gününü tamamlamaz oldu.",
      paragraphs: [
        "Bu ustalık dolu mesleği dedem Ahmet Zeki Tünaydın devraldı. 1957'den itibaren aynı özenle sürdürdü; kahveyi bir içecekten çok bir kültür, bir sabır ve ustalık işi olarak gördü. Daha sonra babam Mustafa Aygün Tünaydın ve kardeşleri bu geleneği yaşattı.",
        "Bugün ben, hem dedemden hem babamdan öğrendiğim bu ilkelerle, geçmişin emek dolu zanaatini yeni nesil kahve anlayışıyla birleştiriyorum. Her fincanda dört neslin emeği, dürüstlüğü ve tutkusu var."
      ],
      details: []
    })
  ]);
  const INFO_ICON_PATHS = Object.freeze({
    shield: '<path d="M12 3 5 6v5c0 4.6 2.9 8.4 7 10 4.1-1.6 7-5.4 7-10V6l-7-3Z"/><path d="m9 12 2 2 4-4"/>',
    phone: '<rect x="6" y="2.5" width="12" height="19" rx="2.2"/><path d="M10 5h4M11 18.5h2"/>',
    bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9Z"/><path d="M10 21h4"/>',
    profile: '<circle cx="9" cy="8" r="3.25"/><path d="M3.5 20v-1.7A4.3 4.3 0 0 1 7.8 14h2.4a4.3 4.3 0 0 1 3.1 1.3"/><circle cx="17.5" cy="17.5" r="2.5"/><path d="M17.5 13.4v1.1m0 6v1.1m4.1-4.1h-1.1m-6 0h-1.1m7-2.9-.8.8m-4.2 4.2-.8.8m5.8 0-.8-.8m-4.2-4.2-.8-.8"/>',
    tag: '<path d="M20.5 13.5 13.7 20a2 2 0 0 1-2.8 0L4 13.1V4h9.1l7.4 6.7a2 2 0 0 1 0 2.8Z"/><circle cx="8.5" cy="8.5" r="1.25"/>',
    coffee: '<path d="M4 9h13v5.5A5.5 5.5 0 0 1 11.5 20h-2A5.5 5.5 0 0 1 4 14.5V9Z"/><path d="M17 11h1.5a2.5 2.5 0 0 1 0 5H17M7 5c0 1 1 1.5 1 2.5M11 4c0 1 1 1.5 1 2.5"/>'
  });
  const legalDocuments = {
    terms: {
      title: "Üyelik Sözleşmesi",
      approve: "Okudum ve Onaylıyorum",
      sections: [
        ["1. Taraflar ve Kapsam", "Bu sözleşme, Tahmisçi markası tarafından sunulan Müdavim hesabının kullanım koşullarını ve üyeyle Tahmisçi arasındaki temel hak ve yükümlülükleri düzenler."],
        ["2. Müdavim Hesabı", "Müdavim hesabı kişiye özeldir. Üye, hesabını doğru bilgilerle oluşturur ve hesabın başkası tarafından kullanılmasına izin vermez."],
        ["3. Üyelik Bilgileri", "Ad soyad, e-posta, profil adı ve isteğe bağlı doğum tarihi üyelik işlemlerinin yürütülmesi için işlenir; bilgilerin güncel tutulması üyenin sorumluluğundadır."],
        ["4. Hesap Güvenliği", "Şifre, doğrulama kodu ve oturum bilgileri gizli tutulmalıdır. Şüpheli kullanım halinde üye şifresini yenilemeli ve Tahmisçi ile iletişime geçmelidir."],
        ["5. Hizmetlerin Kullanımı", "Hizmet hukuka, dürüstlük kurallarına ve uygulama içi yönlendirmelere uygun kullanılmalıdır. Teknik güvenliği veya diğer kullanıcıları etkileyen kullanımlar yasaktır."],
        ["6. Üyelik Avantajları", "Müdavim avantajları sistemde aktif edildiği ölçüde ve ilan edilen kurallar doğrultusunda uygulanır; her özellik her zaman kullanılabilir olmayabilir."],
        ["7. Puan / Ödül Özellikleri", "Puan, ödül veya benzeri sadakat özellikleri ancak ayrıca devreye alınıp koşulları ilan edildiğinde geçerlilik kazanır. Bu sözleşme belirli bir ödül taahhüdü oluşturmaz."],
        ["8. Kötüye Kullanım", "Sahte hesap, yetkisiz erişim, otomatik kötüye kullanım veya avantajları haksız biçimde elde etmeye yönelik işlemler engellenebilir ve incelenebilir."],
        ["9. Hesabın Askıya Alınması veya Sonlandırılması", "Güvenlik, mevzuat veya sözleşmeye aykırılık halinde hesap geçici olarak askıya alınabilir ya da sonlandırılabilir. Kullanıcı da hesabının kapatılmasını talep edebilir."],
        ["10. Hizmet Değişiklikleri", "Tahmisçi, hizmeti güvenlik ve işletim gereksinimleri doğrultusunda güncelleyebilir. Önemli değişiklikler uygun kanallardan duyurulur."],
        ["11. Elektronik İletişim", "Hesap doğrulama, güvenlik ve hizmet mesajları üyeliğin yürütülmesi için gönderilebilir. Kampanya iletileri ayrı ve isteğe bağlı onaya tabidir."],
        ["12. Kişisel Veriler", "Kişisel veriler KVKK Aydınlatma Metni'nde açıklanan amaç, yöntem ve hukuki sebeplerle işlenir."],
        ["13. Sorumluluk ve Güvenlik", "Tahmisçi makul teknik ve idari tedbirleri uygular. Kullanıcının cihazı, bağlantısı veya şifresini korumamasından doğan riskler kullanıcı sorumluluğundadır."],
        ["14. İletişim", "Üyelik ve veri koruma konularındaki talepler Tahmisçi'nin resmi internet sitesinde yayımlanan güncel iletişim kanallarından iletilebilir."],
        ["15. Yürürlük", "Sözleşme, kullanıcı tarafından elektronik ortamda kabul edildiği tarihte yürürlüğe girer ve üyelik sürdüğü müddetçe uygulanır."]
      ]
    },
    privacy: {
      title: "KVKK Aydınlatma Metni",
      approve: "Okudum ve Anladım",
      sections: [
        ["1. Veri Sorumlusu", "Müdavim hizmeti kapsamında kişisel veriler, Tahmisçi markası tarafından veri sorumlusu sıfatıyla işlenir."],
        ["2. İşlenen Kişisel Veriler", "Ad soyad, e-posta, profil adı, verilmişse doğum tarihi, üyelik durumu, kampanya tercihi, doğrulama kayıtları, oturum ve güvenlik kayıtları, cihaz/push aboneliği ile gerekli teknik kullanım kayıtları işlenebilir."],
        ["3. İşleme Amaçları", "Hesabın oluşturulması ve güvenli işletilmesi, e-posta doğrulama, şifre sıfırlama, bildirim tercihleri, duyuruların gösterilmesi, kötüye kullanımın önlenmesi ve yasal yükümlülüklerin yerine getirilmesi amaçlanır."],
        ["4. Kişisel Veri Toplama Yöntemi", "Veriler üyelik ve profil formları, güvenli sunucu oturumları, doğrulama işlemleri, bildirim tercihleri ve uygulamanın teknik kayıtları üzerinden elektronik ortamda elde edilir."],
        ["5. Hukuki Sebepler", "Veriler sözleşmenin kurulması ve ifası, hukuki yükümlülükler, hakkın tesisi ve meşru menfaat sebeplerine dayanılarak; pazarlama iletileri ise ayrı tercihiniz kapsamında işlenir."],
        ["6. Aktarım / Hizmet Sağlayıcıları", "Veriler yalnız hizmetin işletilmesi için gerekli barındırma, e-posta ve push bildirim sağlayıcılarıyla, uygun güvenlik ve gizlilik tedbirleri altında paylaşılabilir; yetkili kurum talepleri kanuni sınırlar içinde karşılanır."],
        ["7. Saklama ve Güvenlik", "Veriler amaç için gerekli süre ve yasal saklama dönemleri boyunca tutulur; erişim kontrolü, kayıt izleme ve teknik güvenlik tedbirleri uygulanır."],
        ["8. Hesap Güvenliği Verileri", "Şifreler geri döndürülemez özetlerle saklanır. Doğrulama kodları, oturumlar ve güvenlik denetim kayıtları yetkisiz erişimi önlemek amacıyla sınırlı sürelerle işlenir."],
        ["9. Push / Cihaz Verileri", "Bildirimleri kullanıcı isteğiyle açmanız halinde cihaz abonelik uç noktası, uygulama hedefi ve teslim durumu kaydedilebilir. Tarayıcı izni verilmeden push aboneliği oluşturulmaz."],
        ["10. Pazarlama Tercihleri", "Kampanya ve fırsat iletileri isteğe bağlıdır. Tercih profilinizden kapatılabilir; bu değişiklik üyelik, doğrulama veya güvenlik mesajlarını engellemez."],
        ["11. İlgili Kişinin Hakları", "KVKK'nın 11. maddesi kapsamındaki bilgi talep etme, düzeltme, silme, işlemeye itiraz ve zararın giderilmesini isteme haklarınızı kullanabilirsiniz."],
        ["12. Başvuru ve İletişim", "Başvurularınızı kimliğinizi doğrulamaya elverişli bilgilerle Tahmisçi'nin resmi internet sitesinde yayımlanan güncel iletişim kanalından iletebilirsiniz."]
      ]
    },
    commercial: {
      title: "Ticari Elektronik İleti Onayı",
      approve: "Okudum ve Onaylıyorum",
      sections: [
        ["İsteğe Bağlı Onay", "Tahmisçi'nin kampanya, fırsat, ürün duyurusu, Müdavim avantajı ve marka duyurularını e-posta ve push bildirimi kanallarından iletmesine isteğe bağlı olarak onay verirsiniz."],
        ["Üyelikten Bağımsızlık", "Bu onay Müdavim hesabı oluşturmak veya hesabı kullanmak için zorunlu değildir. Onay vermemeniz hesap doğrulama, şifre sıfırlama ve güvenlik iletilerini engellemez."],
        ["Onayın Geri Alınması", "Tercihinizi dilediğiniz zaman Müdavim profilinden kapatabilirsiniz. Geri alma işlemi gelecekteki kampanya teslimlerini durdurur ve kayıt zamanı güvenli biçimde saklanır."]
      ]
    }
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initialise, { once: true });
  else initialise();

  function initialise() {
    collectElements();
    renderInfoItems();
    bindEvents();
    renderGuest();
    void Promise.all([loadPublicMudavim(), restoreSession()]);
  }

  function collectElements() {
    [
      "gate", "app", "mudavimAuthOverlay", "memberProfileOverlay", "memberProfileTrigger", "memberProfileForm",
      "memberProfileSave", "memberProfileFullName", "memberProfileAlias", "memberProfileBirthDate",
      "memberProfileCampaignConsent", "memberProfileMudavimNotifications", "memberPushToggle", "memberPushState", "memberInstallButton",
      "memberProfileStatus", "memberAvatar", "memberFullName", "memberWelcomeName",
      "progressCount", "rewardTarget", "progressText", "visitSummaryLabel", "visitSegments", "memberLevel",
      "tierTrack", "centerMemberLevel", "centerVisitCount", "centerRemaining", "latestVisit", "compactVisitHistory",
      "memberHistoryPanel", "memberAnnouncementFeed", "guestMenuButton", "guestMenu", "guestInfoList", "guestInfoOverlay",
      "guestInfoClose", "guestInfoIcon", "guestInfoEyebrow", "guestInfoTitle", "guestInfoDescription", "guestInfoDetails", "guestInfoActions",
      "mudavimLegalOverlay", "mudavimLegalTitle", "mudavimLegalCopy", "mudavimLegalClose", "mudavimLegalCancel",
      "mudavimLegalApprove", "registerResend", "memberNotificationButton", "memberNotificationBadge",
      "memberNotificationFeed", "memberNotificationStatus", "memberNotificationsReadAll"
    ].forEach((id) => { elements[id] = document.getElementById(id); });
    elements.authClose = document.querySelector(".mudavim-auth-close");
  }

  function bindEvents() {
    document.querySelectorAll("[data-auth-open]").forEach((button) => button.addEventListener("click", () => openAuth(button.dataset.authOpen)));
    elements.guestMenuButton?.addEventListener("click", (event) => {
      event.stopPropagation();
      toggleGuestMenu();
    });
    elements.guestMenu?.addEventListener("click", (event) => event.stopPropagation());
    document.querySelectorAll("[data-guest-nav]").forEach((item) => item.addEventListener("click", closeGuestMenu));
    document.querySelectorAll("[data-info-open]").forEach((button) => {
      button.addEventListener("click", () => openInfoModal(button.dataset.infoOpen, button));
    });
    elements.guestInfoClose?.addEventListener("click", closeInfoModal);
    elements.guestInfoOverlay?.addEventListener("click", (event) => {
      if (event.target === elements.guestInfoOverlay) closeInfoModal();
    });
    document.addEventListener("click", (event) => {
      if (!elements.guestMenu?.hidden && !event.target.closest(".mudavim-header")) closeGuestMenu();
    });
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
    elements.registerResend?.addEventListener("click", resendRegistrationCode);
    bindLegalControls();
    document.querySelectorAll('[inputmode="numeric"][maxlength="6"]').forEach((input) => {
      input.addEventListener("input", () => { input.value = input.value.replace(/\D/g, "").slice(0, 6); });
    });
    document.querySelectorAll("[data-member-panel]").forEach((button) => button.addEventListener("click", () => showMemberPanel(button.dataset.memberPanel)));
    document.querySelectorAll("[data-member-panel-close]").forEach((button) => button.addEventListener("click", () => showMemberPanel("welcome")));
    elements.memberProfileTrigger?.addEventListener("click", openProfile);
    document.querySelectorAll("[data-profile-close]").forEach((button) => button.addEventListener("click", closeProfile));
    elements.memberProfileOverlay?.addEventListener("click", (event) => {
      if (event.target === elements.memberProfileOverlay) closeProfile();
    });
    elements.memberProfileSave?.addEventListener("click", saveProfile);
    elements.memberPushToggle?.addEventListener("click", togglePushNotifications);
    elements.memberInstallButton?.addEventListener("click", installMudavimApp);
    elements.memberNotificationsReadAll?.addEventListener("click", markAllNotificationsRead);
    elements.memberNotificationFeed?.addEventListener("click", handleNotificationAction);
    document.querySelector("[data-profile-password-reset]")?.addEventListener("click", () => {
      closeProfile();
      openAuth("forgot");
      const input = document.getElementById("forgotEmail");
      if (input && state.member) input.value = state.member.email || "";
    });
    document.querySelector("[data-logout]")?.addEventListener("click", logout);
    document.addEventListener("keydown", (event) => {
      if (!elements.mudavimLegalOverlay?.hidden) {
        if (event.key === "Escape") closeLegal();
        else if (event.key === "Tab") trapLegalFocus(event);
        return;
      }
      if (!elements.guestInfoOverlay?.hidden) {
        if (event.key === "Escape") closeInfoModal();
        else if (event.key === "Tab") trapInfoFocus(event);
        return;
      }
      if (event.key !== "Escape") return;
      if (elements.guestMenu && !elements.guestMenu.hidden) closeGuestMenu();
      else if (elements.memberProfileOverlay && !elements.memberProfileOverlay.hidden) closeProfile();
      else if (elements.mudavimAuthOverlay && !elements.mudavimAuthOverlay.hidden) closeAuth();
    });
  }

  async function loadPublicMudavim() {
    try {
      const payload = await request("/api/public/mudavim", { method: "GET" });
      state.announcements = Array.isArray(payload.mudavim && payload.mudavim.announcements) ? payload.mudavim.announcements : [];
      state.legalVersions = payload.legalVersions && typeof payload.legalVersions === "object"
        ? payload.legalVersions
        : state.legalVersions;
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
      privacyAcknowledged: Boolean(document.getElementById("registerPrivacy")?.checked),
      campaignConsent: Boolean(document.getElementById("registerCampaigns")?.checked),
      membershipTermsVersion: state.legalVersions.membershipTerms,
      privacyNoticeVersion: state.legalVersions.privacyNotice,
      commercialConsentVersion: state.legalVersions.commercialConsent
    };
    if (!body.fullName || !validEmail(body.email)) return setAuthMessage(form, "Ad soyad ve geçerli e-posta gerekli.");
    if (body.password !== body.passwordConfirm) return setAuthMessage(form, "Şifreler eşleşmiyor.");
    if (!body.termsAccepted || !body.privacyAcknowledged) return setAuthMessage(form, "Üyelik Sözleşmesi ve KVKK Aydınlatma Metni incelenmelidir.");
    if (!body.membershipTermsVersion || !body.privacyNoticeVersion || !body.commercialConsentVersion) {
      return setAuthMessage(form, "Yasal metinler yüklenemedi. Bağlantınızı kontrol edip yeniden deneyin.");
    }
    await withBusy(form, async () => {
      const payload = await request("/api/mudavim/register", { method: "POST", body });
      state.registerChallengeId = payload.challengeId || "";
      showAuthStep("verify-email");
      startResendCountdown(payload.resendAfterSeconds || 60);
      focus("registerVerificationCode");
    });
  }

  async function resendRegistrationCode() {
    if (state.busy || state.resendTimer > 0) return;
    const form = document.querySelector('[data-auth-step="register"]');
    if (!form) return;
    await submitRegister({ preventDefault() {}, currentTarget: form });
    const message = form.querySelector("[data-auth-message]")?.textContent || "";
    if (message) setAuthMessage(document.querySelector('[data-auth-step="verify-email"]'), message, "error");
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
    void loadNotificationPreferences();
    void loadNotifications();
    connectNotificationEvents();
    registerPwaNotificationPrompt();
    document.dispatchEvent(new CustomEvent("mudavim:session-started", { detail: { member: state.member } }));
  }

  function renderGuest() {
    state.member = null;
    state.loyalty = emptyLoyalty();
    state.notifications = [];
    closeNotificationEvents();
    renderNotificationBadge(0);
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
    setText(elements.progressCount, loyalty.available ? String(loyalty.visitCount) : "—");
    setText(elements.rewardTarget, loyalty.available && loyalty.rewardTarget ? ` / ${loyalty.rewardTarget}` : "");
    setText(elements.visitSummaryLabel, loyalty.available ? "ziyaret tamamlandı" : "Henüz ziyaret kaydı yok");
    setText(elements.progressText, loyalty.available && loyalty.rewardTarget
      ? `Bir sonraki ödüle ${Math.max(0, loyalty.rewardTarget - loyalty.visitCount)} ziyaret kaldı.`
      : "Sadakat geçmişi kullanıma açıldığında burada görünecek.");
    setText(elements.memberLevel, loyalty.level || "Henüz yok");
    setText(elements.centerMemberLevel, loyalty.level || "Henüz yok");
    setText(elements.centerVisitCount, loyalty.available ? String(loyalty.visitCount) : "—");
    setText(elements.centerRemaining, loyalty.available && loyalty.rewardTarget
      ? `${Math.max(0, loyalty.rewardTarget - loyalty.visitCount)} ziyaret` : "Henüz ziyaret kaydı yok");
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
    const target = ["welcome", "announcements", "history", "notifications"].includes(panel) ? panel : "welcome";
    state.activePanel = target;
    document.querySelectorAll("[data-member-view]").forEach((view) => { view.hidden = view.dataset.memberView !== target; });
    document.querySelectorAll("[data-member-panel]").forEach((button) => button.setAttribute("aria-pressed", button.dataset.memberPanel === target ? "true" : "false"));
    if (target === "notifications") void loadNotifications();
  }

  function openProfile() {
    if (!state.member || !elements.memberProfileOverlay) return;
    elements.memberProfileFullName.value = state.member.fullName || "";
    elements.memberProfileAlias.value = state.member.alias || "";
    elements.memberProfileBirthDate.value = state.member.birthDate || "";
    elements.memberProfileCampaignConsent.checked = state.member.campaignConsent === true;
    if (elements.memberProfileMudavimNotifications) {
      elements.memberProfileMudavimNotifications.checked = state.notificationPreferences?.mudavimNotifications !== false;
    }
    renderPushState();
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
      try {
        await saveNotificationPreferences();
      } catch (_notificationError) {
        setProfileMessage("Profil kaydedildi; bildirim tercihleri güncellenemedi.", "error");
        return;
      }
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
    closeGuestMenu();
    closeInfoModal({ restoreFocus: false });
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

  function renderInfoItems() {
    if (!elements.guestInfoList) return;
    elements.guestInfoList.replaceChildren();
    INFO_ITEM_DEFINITIONS.filter((item) => item.landing).forEach((item) => {
      const button = document.createElement("button");
      button.className = "feature-row";
      button.type = "button";
      button.dataset.infoOpen = item.id;
      button.setAttribute("aria-haspopup", "dialog");
      button.setAttribute("aria-controls", "guestInfoOverlay");

      const icon = document.createElement("span");
      icon.className = "feature-row__icon";
      icon.setAttribute("aria-hidden", "true");
      icon.innerHTML = infoIconMarkup(item.icon);

      const title = document.createElement("strong");
      title.className = "feature-row__title";
      title.textContent = item.title;

      const chevron = document.createElement("span");
      chevron.className = "feature-row__chevron";
      chevron.setAttribute("aria-hidden", "true");
      chevron.innerHTML = '<svg viewBox="0 0 24 24"><path d="m9 5 7 7-7 7"/></svg>';

      button.append(icon, title, chevron);
      elements.guestInfoList.append(button);
    });
  }

  function infoIconMarkup(icon) {
    const paths = INFO_ICON_PATHS[icon] || INFO_ICON_PATHS.coffee;
    return `<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">${paths}</svg>`;
  }

  function openInfoModal(itemId, trigger) {
    const item = INFO_ITEM_DEFINITIONS.find((definition) => definition.id === itemId);
    if (!item || !elements.guestInfoOverlay) return;
    closeGuestMenu();
    state.activeInfoItem = item.id;
    state.infoReturnFocus = trigger instanceof HTMLElement
      ? trigger
      : document.activeElement instanceof HTMLElement ? document.activeElement : null;

    elements.guestInfoIcon.innerHTML = infoIconMarkup(item.icon);
    setText(elements.guestInfoEyebrow, item.eyebrow);
    setText(elements.guestInfoTitle, item.title);
    elements.guestInfoDescription.replaceChildren();
    [item.description].concat(item.paragraphs || []).filter(Boolean).forEach((copy) => {
      const paragraph = document.createElement("p");
      paragraph.textContent = copy;
      elements.guestInfoDescription.append(paragraph);
    });
    elements.guestInfoDetails.replaceChildren();
    (item.details || []).forEach((detail) => {
      const row = document.createElement("li");
      row.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>';
      const label = document.createElement("span");
      label.textContent = detail;
      row.append(label);
      elements.guestInfoDetails.append(row);
    });
    elements.guestInfoDetails.hidden = !(item.details || []).length;
    renderInfoAction(item);

    elements.guestInfoOverlay.hidden = false;
    document.body.classList.add("guest-card-open");
    window.setTimeout(() => elements.guestInfoClose?.focus(), 20);
  }

  function renderInfoAction(item) {
    if (!elements.guestInfoActions) return;
    elements.guestInfoActions.replaceChildren();
    let label = "";
    if (item.action === "install" && window.TahmisciPWA?.canInstall()) label = "Uygulamaya Ekle";
    if (item.action === "notifications" && state.member && "Notification" in window && Notification.permission === "default") {
      label = "Bildirimleri Aç";
    }
    elements.guestInfoActions.hidden = !label;
    if (!label) return;
    const button = document.createElement("button");
    button.className = "mudavim-info-modal__action";
    button.type = "button";
    button.textContent = label;
    button.addEventListener("click", () => runInfoAction(item, button));
    elements.guestInfoActions.append(button);
  }

  async function runInfoAction(item, button) {
    button.disabled = true;
    const original = button.textContent;
    button.textContent = "Açılıyor…";
    try {
      if (item.action === "install") {
        const installed = await window.TahmisciPWA?.promptInstall();
        if (!installed) throw new Error("Yükleme tamamlanmadı.");
        closeInfoModal();
        return;
      }
      if (item.action === "notifications") {
        await enablePushNotifications();
        closeInfoModal();
      }
    } catch (_error) {
      button.disabled = false;
      button.textContent = original;
    }
  }

  function toggleGuestMenu() {
    if (!elements.guestMenu || !elements.guestMenuButton) return;
    const open = elements.guestMenu.hidden;
    elements.guestMenu.hidden = !open;
    elements.guestMenuButton.setAttribute("aria-expanded", String(open));
    elements.guestMenuButton.setAttribute("aria-label", open ? "Menüyü kapat" : "Menüyü aç");
    elements.guestMenuButton.classList.toggle("is-open", open);
  }

  function closeGuestMenu() {
    if (!elements.guestMenu || !elements.guestMenuButton) return;
    elements.guestMenu.hidden = true;
    elements.guestMenuButton.setAttribute("aria-expanded", "false");
    elements.guestMenuButton.setAttribute("aria-label", "Menüyü aç");
    elements.guestMenuButton.classList.remove("is-open");
  }

  function closeInfoModal(options = {}) {
    if (!elements.guestInfoOverlay || elements.guestInfoOverlay.hidden) return;
    elements.guestInfoOverlay.hidden = true;
    document.body.classList.remove("guest-card-open");
    state.activeInfoItem = "";
    const returnFocus = state.infoReturnFocus;
    state.infoReturnFocus = null;
    const focusTarget = returnFocus?.closest("#guestMenu") ? elements.guestMenuButton : returnFocus;
    if (options.restoreFocus !== false && focusTarget?.isConnected) focusTarget.focus({ preventScroll: true });
  }

  function trapInfoFocus(event) {
    const modal = elements.guestInfoOverlay?.querySelector(".mudavim-info-modal");
    if (!modal) return;
    const focusable = Array.from(modal.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])'));
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function bindLegalControls() {
    document.querySelectorAll("[data-legal-open]").forEach((button) => {
      button.addEventListener("click", () => openLegal(button.dataset.legalOpen, legalInput(button.dataset.legalOpen)));
    });
    for (const kind of ["terms", "privacy"]) {
      const input = legalInput(kind);
      input?.addEventListener("click", (event) => {
        event.preventDefault();
        openLegal(kind, input);
      });
    }
    bindOptionalConsent(document.getElementById("registerCampaigns"), "commercial");
    bindOptionalConsent(elements.memberProfileCampaignConsent, "commercial");
    elements.mudavimLegalClose?.addEventListener("click", closeLegal);
    elements.mudavimLegalCancel?.addEventListener("click", closeLegal);
    elements.mudavimLegalApprove?.addEventListener("click", approveLegal);
    elements.mudavimLegalOverlay?.addEventListener("click", (event) => {
      if (event.target === elements.mudavimLegalOverlay) closeLegal();
    });
  }

  function bindOptionalConsent(input, kind) {
    input?.addEventListener("click", (event) => {
      if (!event.isTrusted || !input.checked) return;
      event.preventDefault();
      input.checked = false;
      openLegal(kind, input);
    });
  }

  function legalInput(kind) {
    return document.getElementById(kind === "terms" ? "registerTerms" : kind === "privacy" ? "registerPrivacy" : "registerCampaigns");
  }

  function openLegal(kind, target) {
    const documentConfig = legalDocuments[kind];
    if (!documentConfig || !elements.mudavimLegalOverlay) return;
    state.activeLegal = kind;
    state.legalTarget = target || legalInput(kind);
    state.legalReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setText(elements.mudavimLegalTitle, documentConfig.title);
    setText(elements.mudavimLegalApprove, documentConfig.approve);
    const fragment = document.createDocumentFragment();
    documentConfig.sections.forEach(([heading, copy]) => {
      const section = document.createElement("section");
      const title = document.createElement("h3");
      const paragraph = document.createElement("p");
      title.textContent = heading;
      paragraph.textContent = copy;
      section.append(title, paragraph);
      fragment.appendChild(section);
    });
    elements.mudavimLegalCopy.replaceChildren(fragment);
    elements.mudavimLegalCopy.scrollTop = 0;
    elements.mudavimLegalOverlay.hidden = false;
    document.body.classList.add("legal-open");
    window.setTimeout(() => elements.mudavimLegalClose?.focus(), 20);
  }

  function approveLegal() {
    if (state.legalTarget instanceof HTMLInputElement) {
      state.legalTarget.checked = true;
      state.legalTarget.dispatchEvent(new Event("change", { bubbles: true }));
    }
    closeLegal();
  }

  function closeLegal() {
    if (!elements.mudavimLegalOverlay || elements.mudavimLegalOverlay.hidden) return;
    elements.mudavimLegalOverlay.hidden = true;
    document.body.classList.remove("legal-open");
    state.activeLegal = "";
    state.legalTarget = null;
    const target = state.legalReturnFocus;
    state.legalReturnFocus = null;
    if (target && document.contains(target)) target.focus({ preventScroll: true });
  }

  function trapLegalFocus(event) {
    const modal = elements.mudavimLegalOverlay?.querySelector(".mudavim-legal-modal");
    if (!modal) return;
    const focusable = Array.from(modal.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])'));
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  function startResendCountdown(seconds) {
    window.clearInterval(state.resendInterval);
    state.resendTimer = Math.max(0, Math.ceil(Number(seconds || 0)));
    renderResendCountdown();
    if (!state.resendTimer) return;
    state.resendInterval = window.setInterval(() => {
      state.resendTimer = Math.max(0, state.resendTimer - 1);
      renderResendCountdown();
      if (!state.resendTimer) {
        window.clearInterval(state.resendInterval);
        state.resendInterval = 0;
      }
    }, 1000);
  }

  function renderResendCountdown() {
    if (!elements.registerResend) return;
    elements.registerResend.disabled = state.resendTimer > 0 || state.busy;
    elements.registerResend.textContent = state.resendTimer > 0
      ? `Yeni kod gönder — ${state.resendTimer} sn`
      : "Kodu yeniden gönder";
  }

  async function loadNotificationPreferences() {
    if (!state.member) return null;
    try {
      const payload = await request("/api/mudavim/notifications/preferences");
      state.notificationPreferences = payload.preferences || null;
      state.notificationCapabilities = payload.capabilities || null;
      if (elements.memberProfileMudavimNotifications) {
        elements.memberProfileMudavimNotifications.checked = state.notificationPreferences?.mudavimNotifications !== false;
      }
      renderPushState();
      return payload;
    } catch (_error) {
      state.notificationPreferences = null;
      renderPushState();
      return null;
    }
  }

  async function saveNotificationPreferences() {
    if (!state.member) return;
    const payload = await request("/api/mudavim/notifications/preferences", {
      method: "PATCH",
      body: {
        mudavimNotifications: elements.memberProfileMudavimNotifications?.checked !== false,
        campaignNotifications: elements.memberProfileCampaignConsent?.checked === true,
        systemNotifications: true
      }
    });
    state.notificationPreferences = payload.preferences || state.notificationPreferences;
    state.notificationCapabilities = payload.capabilities || state.notificationCapabilities;
    renderPushState();
  }

  function renderPushState() {
    if (!elements.memberPushToggle) return;
    const enabled = state.notificationPreferences?.pushEnabled === true && window.Notification?.permission === "granted";
    elements.memberPushToggle.classList.toggle("is-enabled", enabled);
    elements.memberPushToggle.querySelector("b").textContent = enabled ? "Kapat" : "Bildirimleri Aç";
    setText(elements.memberPushState, enabled ? "Bu cihazda açık" : "Bu cihazda kapalı");
  }

  async function togglePushNotifications() {
    if (state.busy || !state.member) return;
    state.busy = true;
    elements.memberPushToggle.disabled = true;
    try {
      if (state.notificationPreferences?.pushEnabled === true) {
        const payload = await request("/api/mudavim/notifications/preferences", { method: "PATCH", body: { pushEnabled: false } });
        state.notificationPreferences = payload.preferences;
        renderPushState();
        setProfileMessage("Push bildirimleri bu cihaz için kapatıldı.", "success");
        return;
      }
      await enablePushNotifications();
      setProfileMessage("Push bildirimleri bu cihaz için açıldı.", "success");
    } catch (error) {
      setProfileMessage(error.message || "Push bildirimleri güncellenemedi.", "error");
    } finally {
      state.busy = false;
      elements.memberPushToggle.disabled = false;
    }
  }

  async function enablePushNotifications() {
    if (!("Notification" in window) || !("PushManager" in window)) throw new Error("Bu tarayıcı push bildirimlerini desteklemiyor.");
    const preferencesPayload = state.notificationCapabilities ? null : await loadNotificationPreferences();
    const capabilities = preferencesPayload?.capabilities || state.notificationCapabilities;
    if (!capabilities?.pushSupported || !capabilities.vapidPublicKey) throw new Error("Telefon bildirimleri sunucuda henüz etkin değil.");
    const permission = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
    if (permission !== "granted") throw new Error("Bildirim izni verilmedi.");
    const registration = await window.TahmisciPWA?.ensureServiceWorker();
    if (!registration) throw new Error("Uygulama bildirim servisi başlatılamadı.");
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: base64UrlBytes(capabilities.vapidPublicKey)
    });
    await request("/api/mudavim/notifications/push-subscriptions", {
      method: "POST",
      headers: { "x-tahmisci-app-id": "mudavim", "x-tahmisci-device-id": notificationDeviceId() },
      body: { subscription: subscription.toJSON(), appTarget: "mudavim", deviceId: notificationDeviceId(), deviceName: navigator.platform || "Bu cihaz" }
    });
    const payload = await request("/api/mudavim/notifications/preferences", { method: "PATCH", body: { pushEnabled: true } });
    state.notificationPreferences = payload.preferences;
    state.notificationCapabilities = payload.capabilities;
    renderPushState();
    return true;
  }

  function registerPwaNotificationPrompt() {
    window.TahmisciPWA?.registerNotificationPrompt({
      canShow: async () => Boolean(state.member && (await loadNotificationPreferences())?.capabilities?.pushSupported),
      onEnable: enablePushNotifications
    });
  }

  async function installMudavimApp() {
    if (window.matchMedia?.("(display-mode: standalone)").matches || navigator.standalone === true) {
      setProfileMessage("Tahmisçi Müdavim zaten uygulama olarak açık.", "success");
      return;
    }
    if (window.TahmisciPWA?.canInstall()) {
      const installed = await window.TahmisciPWA.promptInstall();
      setProfileMessage(installed ? "Uygulama yükleme işlemi başlatıldı." : "Yükleme tamamlanmadı.", installed ? "success" : "error");
      return;
    }
    const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent) || navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
    setProfileMessage(isIos ? "Safari'de Paylaş → Ana Ekrana Ekle seçeneğini kullanın." : "Tarayıcınız yükleme seçeneğini henüz sunmuyor.", "error");
  }

  async function loadNotifications() {
    if (!state.member) return;
    try {
      const payload = await request("/api/mudavim/notifications?limit=50");
      state.notifications = Array.isArray(payload.notifications) ? payload.notifications : [];
      renderNotificationBadge(payload.unreadCount);
      renderNotifications();
    } catch (error) {
      setText(elements.memberNotificationStatus, error.message || "Bildirimler alınamadı.");
    }
  }

  function renderNotifications() {
    if (!elements.memberNotificationFeed) return;
    setText(elements.memberNotificationStatus, "");
    if (!state.notifications.length) {
      elements.memberNotificationFeed.innerHTML = '<div class="member-empty member-empty--panel"><strong>Yeni bildirim yok</strong><p>Hesap ve Müdavim duyuruları burada kalıcı olarak görünür.</p></div>';
      return;
    }
    const fragment = document.createDocumentFragment();
    state.notifications.forEach((notification) => {
      const article = document.createElement("article");
      article.className = `member-notification-item${notification.readAt ? "" : " is-unread"}`;
      article.dataset.notificationId = notification.id;
      const open = document.createElement("button");
      open.type = "button";
      open.className = "member-notification-item__open";
      open.dataset.notificationAction = "open";
      const title = document.createElement("strong");
      const body = document.createElement("span");
      const time = document.createElement("time");
      title.textContent = notification.title || "Bildirim";
      body.textContent = notification.body || "";
      time.textContent = formatDate(notification.createdAt);
      open.append(title, body, time);
      const archive = document.createElement("button");
      archive.type = "button";
      archive.className = "member-notification-item__archive";
      archive.dataset.notificationAction = "archive";
      archive.setAttribute("aria-label", "Bildirimi arşivle");
      archive.innerHTML = '<i class="fas fa-box-archive" aria-hidden="true"></i>';
      article.append(open, archive);
      fragment.appendChild(article);
    });
    elements.memberNotificationFeed.replaceChildren(fragment);
  }

  async function handleNotificationAction(event) {
    const button = event.target.closest("[data-notification-action]");
    const article = button?.closest("[data-notification-id]");
    if (!button || !article) return;
    const notification = state.notifications.find((item) => item.id === article.dataset.notificationId);
    if (!notification) return;
    if (button.dataset.notificationAction === "archive") {
      const payload = await request(`/api/mudavim/notifications/${encodeURIComponent(notification.id)}/archive`, { method: "PATCH" });
      state.notifications = state.notifications.filter((item) => item.id !== notification.id);
      renderNotificationBadge(payload.unreadCount);
      renderNotifications();
      return;
    }
    if (!notification.readAt) {
      const payload = await request(`/api/mudavim/notifications/${encodeURIComponent(notification.id)}/read`, { method: "PATCH" });
      notification.readAt = payload.notification?.readAt || new Date().toISOString();
      renderNotificationBadge(payload.unreadCount);
      renderNotifications();
    }
    if (String(notification.deepLink || "").startsWith("/mudavim/")) window.location.assign(notification.deepLink);
  }

  async function markAllNotificationsRead() {
    const payload = await request("/api/mudavim/notifications/read-all", { method: "POST", body: {} });
    const timestamp = new Date().toISOString();
    state.notifications = state.notifications.map((item) => ({ ...item, readAt: item.readAt || timestamp }));
    renderNotificationBadge(payload.unreadCount);
    renderNotifications();
  }

  function renderNotificationBadge(value) {
    const count = Math.max(0, Number(value || 0));
    if (elements.memberNotificationBadge) {
      elements.memberNotificationBadge.hidden = count < 1;
      elements.memberNotificationBadge.textContent = count > 99 ? "99+" : String(count);
    }
    window.TahmisciPWA?.updateBadge(count);
  }

  function connectNotificationEvents() {
    if (!state.member || state.notificationEvents || !("EventSource" in window)) return;
    const source = new EventSource("/api/mudavim/notifications/events", { withCredentials: true });
    source.addEventListener("ready", (event) => updateNotificationEvent(event));
    source.addEventListener("notification", (event) => updateNotificationEvent(event));
    state.notificationEvents = source;
  }

  function updateNotificationEvent(event) {
    try {
      const payload = JSON.parse(event.data || "{}");
      renderNotificationBadge(payload.unreadCount);
      if (payload.notification && !state.notifications.some((item) => item.id === payload.notification.id)) state.notifications.unshift(payload.notification);
      if (state.activePanel === "notifications" || payload.requiresRefetch) void loadNotifications();
    } catch (_error) {}
  }

  function closeNotificationEvents() {
    state.notificationEvents?.close();
    state.notificationEvents = null;
  }

  function notificationDeviceId() {
    const key = "tahmisci.notifications.mudavim.device.v1";
    try {
      let id = window.localStorage.getItem(key);
      if (!id) {
        id = window.crypto?.randomUUID ? window.crypto.randomUUID() : `mudavim-${Date.now()}-${Math.random().toString(16).slice(2)}`;
        window.localStorage.setItem(key, id);
      }
      return id;
    } catch (_error) { return ""; }
  }

  function base64UrlBytes(value) {
    const padding = "=".repeat((4 - String(value).length % 4) % 4);
    const decoded = atob((String(value) + padding).replace(/-/g, "+").replace(/_/g, "/"));
    return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
  }

  async function withBusy(form, operation) {
    state.busy = true;
    renderResendCountdown();
    setAuthMessage(form, "İşlem yapılıyor…");
    form.querySelectorAll("button, input").forEach((control) => { control.disabled = true; });
    try { await operation(); }
    catch (error) {
      if (error.retryAfterSeconds) startResendCountdown(error.retryAfterSeconds);
      if (error.code === "LEGAL_DOCUMENT_VERSION_CHANGED") {
        ["registerTerms", "registerPrivacy", "registerCampaigns"].forEach((id) => { const input = document.getElementById(id); if (input) input.checked = false; });
        void loadPublicMudavim();
      }
      setAuthMessage(form, error.message || "İşlem tamamlanamadı.", "error");
    }
    finally {
      state.busy = false;
      form.querySelectorAll("button, input").forEach((control) => { control.disabled = false; });
      renderResendCountdown();
    }
  }

  async function request(path, options = {}) {
    const method = String(options.method || "GET").toUpperCase();
    if (method !== "GET" && method !== "HEAD" && navigator.onLine === false) throw new Error("Bağlantı gerekli.");
    const headers = { Accept: "application/json", ...(options.headers || {}) };
    const init = { method, credentials: "include", cache: "no-store", headers };
    if (options.body !== undefined) { headers["Content-Type"] = "application/json"; init.body = JSON.stringify(options.body); }
    const response = await fetch(path, init);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok === false) {
      const error = new Error(payload.message || "İşlem tamamlanamadı.");
      error.status = response.status;
      error.code = payload.code || "";
      error.retryAfterSeconds = Math.max(0, Number(payload.retryAfterSeconds || response.headers.get("Retry-After") || 0));
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
