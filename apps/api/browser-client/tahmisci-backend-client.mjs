// Developer: Uzeyir | System Key: xandar | Source integrity marker
// Optional browser helper for GitHub Pages menu/Yönetici integration.
// Usage:
// const api = new TahmisciBackendClient("https://admin.tahmiscicoffee.com");

export class TahmisciBackendClient {
  constructor(baseUrl) {
    this.baseUrl = String(baseUrl || "").replace(/\/+$/, "");
    this.tokenKey = "tahmisci.backend.panel.token";
    this.publishRevision = null;
  }

  async getMenu() {
    const result = await this.request("/api/menu");
    this.rememberPublishRevision(result);
    return result.menuState;
  }

  async login(password) {
    const result = await this.request("/api/admin/login", {
      method: "POST",
      body: { password }
    });
    window.sessionStorage.setItem(this.tokenKey, result.token);
    return result;
  }

  async me() {
    return this.request("/api/admin/me", {
      token: this.token
    });
  }

  async logout() {
    const result = await this.request("/api/admin/logout", {
      method: "POST",
      token: this.token
    });
    window.sessionStorage.removeItem(this.tokenKey);
    return result;
  }

  async saveMenu(menuState) {
    const body = { menuState };
    if (Number.isSafeInteger(this.publishRevision) && this.publishRevision >= 0) {
      body.expectedRevision = this.publishRevision;
    }
    const result = await this.request("/api/menu", {
      method: "PUT",
      token: this.token,
      body
    });
    this.rememberPublishRevision(result);
    return result;
  }

  async uploadMedia(file, kind = "video") {
    const result = await this.request("/api/media", {
      method: "POST",
      token: this.token,
      rawBody: file,
      headers: {
        "Content-Type": file.type || "application/octet-stream",
        "X-File-Name": encodeURIComponent(file.name || ""),
        "X-Media-Kind": kind
      }
    });
    return result.media;
  }

  async getRecipes() {
    const result = await this.request("/api/recipes");
    return result.recipeState;
  }

  async saveRecipes(recipeState) {
    return this.request("/api/recipes", {
      method: "PUT",
      token: this.token,
      body: { recipeState }
    });
  }

  async getSite() {
    const result = await this.request("/api/site");
    return result.siteState;
  }

  async saveSite(siteState) {
    return this.request("/api/site", {
      method: "PUT",
      token: this.token,
      body: { siteState }
    });
  }

  listenMenu(onMenu, onError = console.error) {
    const source = new EventSource(`${this.baseUrl}/api/menu/events`);

    source.addEventListener("menu", (event) => {
      const payload = JSON.parse(event.data);
      onMenu(payload.menuState, payload.updatedAt);
    });

    source.addEventListener("error", onError);
    return () => source.close();
  }

  listenRecipes(onRecipes, onError = console.error) {
    const source = new EventSource(`${this.baseUrl}/api/recipes/events`);

    source.addEventListener("recipes", (event) => {
      const payload = JSON.parse(event.data);
      onRecipes(payload.recipeState, payload.updatedAt);
    });

    source.addEventListener("error", onError);
    return () => source.close();
  }

  get token() {
    return window.sessionStorage.getItem(this.tokenKey) || "";
  }

  rememberPublishRevision(result) {
    const revision = Number(result && result.publishRevision);
    if (Number.isSafeInteger(revision) && revision >= 0) this.publishRevision = revision;
  }

  async request(path, options = {}) {
    const hasRawBody = Object.prototype.hasOwnProperty.call(options, "rawBody");
    const headers = {
      ...(hasRawBody ? {} : { "Content-Type": "application/json" }),
      ...options.headers
    };

    if (options.token) {
      headers.Authorization = `Bearer ${options.token}`;
    }

    const response = await fetch(`${this.baseUrl}${path}`, {
      method: options.method || "GET",
      headers,
      credentials: "include",
      body: hasRawBody ? options.rawBody : options.body ? JSON.stringify(options.body) : undefined
    });

    const result = await response.json().catch(() => ({}));

    if (!response.ok || result.ok === false) {
      throw new Error(result.message || "Backend istegi basarisiz.");
    }

    return result;
  }
}
