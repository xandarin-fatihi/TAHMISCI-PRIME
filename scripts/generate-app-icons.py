"""Generate deterministic Tahmisci PWA icon variants from project masters."""

from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
ICON_ROOT = ROOT / "public" / "assets" / "app-icons"
BRAND_ROOT = ROOT / "public" / "assets" / "brand"
IVORY = (251, 246, 238, 255)
MENU_BACKGROUND = (49, 76, 34, 255)
MENU_FOREGROUND = (143, 166, 129, 255)
MASTER_SIZE = 1024
RESAMPLE = Image.Resampling.LANCZOS


def contain(image: Image.Image, size: tuple[int, int]) -> Image.Image:
    fitted = image.copy()
    fitted.thumbnail(size, RESAMPLE)
    return fitted


def opaque_square(source: Path, background: tuple[int, int, int, int]) -> Image.Image:
    image = Image.open(source).convert("RGBA")
    side = min(image.size)
    left = (image.width - side) // 2
    top = (image.height - side) // 2
    image = image.crop((left, top, left + side, top + side)).resize((MASTER_SIZE, MASTER_SIZE), RESAMPLE)
    canvas = Image.new("RGBA", (MASTER_SIZE, MASTER_SIZE), background)
    canvas.alpha_composite(image)
    return canvas


def build_menu_master(destination: Path) -> None:
    logo = Image.open(BRAND_ROOT / "logo-large.png").convert("RGBA")
    alpha = logo.getchannel("A")
    bounds = alpha.getbbox()
    if not bounds:
        raise RuntimeError("Tahmisci menu logo has no visible pixels")
    logo = logo.crop(bounds)
    alpha = logo.getchannel("A")
    mark = Image.new("RGBA", logo.size, MENU_FOREGROUND)
    mark.putalpha(alpha)
    mark = contain(mark, (780, 690))
    canvas = Image.new("RGBA", (MASTER_SIZE, MASTER_SIZE), MENU_BACKGROUND)
    canvas.alpha_composite(mark, ((MASTER_SIZE - mark.width) // 2, (MASTER_SIZE - mark.height) // 2))
    destination.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(destination, "PNG", optimize=True)


def save_resized(master: Image.Image, destination: Path, size: int) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    master.resize((size, size), RESAMPLE).save(destination, "PNG", optimize=True)


def save_maskable(master: Image.Image, destination: Path, size: int, background: tuple[int, int, int, int]) -> None:
    canvas = Image.new("RGBA", (size, size), background)
    safe_size = round(size * 0.76)
    safe = master.resize((safe_size, safe_size), RESAMPLE)
    offset = (size - safe_size) // 2
    canvas.alpha_composite(safe, (offset, offset))
    canvas.save(destination, "PNG", optimize=True)


def generate_family(name: str, background: tuple[int, int, int, int]) -> None:
    folder = ICON_ROOT / name
    master_path = folder / "master-1024.png"
    master = opaque_square(master_path, background)
    master.save(master_path, "PNG", optimize=True)

    for filename, size in (
        ("favicon-32.png", 32),
        ("favicon-48.png", 48),
        ("apple-touch-icon-180.png", 180),
        ("icon-192.png", 192),
        ("icon-512.png", 512),
    ):
        save_resized(master, folder / filename, size)

    for filename, size in (("icon-maskable-192.png", 192), ("icon-maskable-512.png", 512)):
        save_maskable(master, folder / filename, size, background)


def verify_family(name: str) -> None:
    expected = {
        "favicon-32.png": 32,
        "favicon-48.png": 48,
        "apple-touch-icon-180.png": 180,
        "icon-192.png": 192,
        "icon-maskable-192.png": 192,
        "icon-512.png": 512,
        "icon-maskable-512.png": 512,
        "master-1024.png": 1024,
    }
    folder = ICON_ROOT / name
    for filename, size in expected.items():
        path = folder / filename
        image = Image.open(path).convert("RGBA")
        if image.size != (size, size) or image.getchannel("A").getextrema() != (255, 255):
            raise RuntimeError(f"Invalid generated icon: {path}")
        print(f"{path.relative_to(ROOT).as_posix()} {size}x{size}")


def main() -> None:
    build_menu_master(ICON_ROOT / "menu" / "master-1024.png")
    generate_family("menu", MENU_BACKGROUND)
    generate_family("personel", IVORY)
    generate_family("yonetici", IVORY)
    for family in ("menu", "personel", "yonetici"):
        verify_family(family)


if __name__ == "__main__":
    main()
