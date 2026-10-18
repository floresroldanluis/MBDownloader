from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "design" / "logo-options" / "option-3-play-download.png"
PNG_OUTPUT = ROOT / "src" / "renderer" / "assets" / "mb-logo.png"
ICO_OUTPUT = ROOT / "build" / "icon.ico"
HEADER_OUTPUT = ROOT / "build" / "installerHeader.bmp"
SIDEBAR_OUTPUT = ROOT / "build" / "installerSidebar.bmp"


def fitted_logo(size: int, padding_ratio: float = 0.08) -> Image.Image:
    source = Image.open(SOURCE).convert("RGBA")
    alpha_box = source.getchannel("A").getbbox()
    if alpha_box:
        source = source.crop(alpha_box)
    available = round(size * (1 - (padding_ratio * 2)))
    source.thumbnail((available, available), Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    canvas.alpha_composite(source, ((size - source.width) // 2, (size - source.height) // 2))
    return canvas


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    windows_fonts = Path("C:/Windows/Fonts")
    filename = "segoeuib.ttf" if bold else "segoeui.ttf"
    return ImageFont.truetype(windows_fonts / filename, size)


def build_installer_sidebar(logo: Image.Image) -> None:
    image = Image.new("RGB", (164, 314), "#071329")
    image.paste(logo.resize((112, 112), Image.Resampling.LANCZOS), (26, 45), logo.resize((112, 112), Image.Resampling.LANCZOS))
    draw = ImageDraw.Draw(image)
    title_font = font(15, bold=True)
    subtitle_font = font(10)
    title = "MB Downloader"
    subtitle = "VIDEO  ·  DESCARGA"
    title_width = draw.textlength(title, font=title_font)
    subtitle_width = draw.textlength(subtitle, font=subtitle_font)
    draw.text(((164 - title_width) / 2, 184), title, fill="#FFFFFF", font=title_font)
    draw.text(((164 - subtitle_width) / 2, 210), subtitle, fill="#48DDF3", font=subtitle_font)
    image.save(SIDEBAR_OUTPUT, format="BMP")


def build_installer_header(logo: Image.Image) -> None:
    image = Image.new("RGB", (150, 57), "#EFF6FF")
    mark = logo.resize((48, 48), Image.Resampling.LANCZOS)
    image.paste(mark, (96, 4), mark)
    draw = ImageDraw.Draw(image)
    draw.text((8, 12), "MB", fill="#071329", font=font(12, bold=True))
    draw.text((8, 30), "DOWNLOADER", fill="#086BEE", font=font(9))
    image.save(HEADER_OUTPUT, format="BMP")


def main() -> None:
    logo = fitted_logo(1024)
    logo.save(PNG_OUTPUT, format="PNG", optimize=True)
    icon = fitted_logo(256, padding_ratio=0.06)
    icon.save(ICO_OUTPUT, format="ICO", sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
    build_installer_sidebar(logo)
    build_installer_header(logo)


if __name__ == "__main__":
    main()
