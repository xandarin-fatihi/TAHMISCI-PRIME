(() => {
  const sizes = new Map([[320, 568], [390, 844], [430, 932]]);
  const params = new URLSearchParams(location.search);
  const view = params.get("view") === "home" ? "home" : "menu";
  const stage = document.querySelector(".preview-stage");
  const phone = document.querySelector(".preview-phone");
  const frame = document.querySelector("iframe");
  const sizeButtons = document.querySelectorAll("[data-width]");
  const viewLinks = document.querySelectorAll("[data-view]");
  let width = sizes.has(Number(params.get("width"))) ? Number(params.get("width")) : 390;

  function fitPhone() {
    const height = sizes.get(width);
    const scale = Math.max(0.01, Math.min(1, (stage.clientWidth - 4) / width, (stage.clientHeight - 4) / height));
    phone.style.width = `${width * scale}px`;
    phone.style.height = `${height * scale}px`;
    frame.style.width = `${width}px`;
    frame.style.height = `${height}px`;
    frame.style.transform = `scale(${scale})`;
  }

  function syncControls() {
    sizeButtons.forEach((button) => button.setAttribute("aria-pressed", String(Number(button.dataset.width) === width)));
    viewLinks.forEach((link) => {
      link.href = `?view=${link.dataset.view}&width=${width}`;
      if (link.dataset.view === view) link.setAttribute("aria-current", "page");
    });
    fitPhone();
  }

  sizeButtons.forEach((button) => button.addEventListener("click", () => {
    width = Number(button.dataset.width);
    params.set("width", String(width));
    history.replaceState(null, "", `?${params}`);
    syncControls();
  }));
  syncControls();
  frame.src = view === "home" ? "/?preview=menu&view=home" : "/?preview=menu";
  frame.hidden = false;
  new ResizeObserver(fitPhone).observe(stage);
})();
