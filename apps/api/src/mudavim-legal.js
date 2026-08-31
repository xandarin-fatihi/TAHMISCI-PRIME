"use strict";

const MUDAVIM_LEGAL_VERSIONS = Object.freeze({
  membershipTerms: "2026-08-30",
  privacyNotice: "2026-08-30",
  commercialConsent: "2026-08-30"
});

module.exports = {
  MUDAVIM_LEGAL_VERSIONS,
  MUDAVIM_TERMS_VERSION: MUDAVIM_LEGAL_VERSIONS.membershipTerms,
  MUDAVIM_PRIVACY_VERSION: MUDAVIM_LEGAL_VERSIONS.privacyNotice,
  MUDAVIM_COMMERCIAL_CONSENT_VERSION: MUDAVIM_LEGAL_VERSIONS.commercialConsent
};
